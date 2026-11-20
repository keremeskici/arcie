import { ArcieError, type AgentLimits, type Channel } from "@arcie/core";
import { confirmClaims, intents, sessionState, sessions, users, type DbOrTx, type Db, type Tx } from "@arcie/db";
import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { assertConfirmable } from "./intents/machine.js";
import { IntentRepo, QUOTE_FRESH_MS } from "./intents/repo.js";
import type { HarnessCtx } from "./context.js";
import type { PolicyProvider } from "./policy/provider.js";

/**
 * Cross-instance proposal coordination. A proposal's slow preparation (Circle/estimate calls) runs outside
 * any transaction; only publishing takes a row lock on `session_state`, so a cancel or a newer proposal on
 * any server instance makes a stale preparation write nothing.
 */

/** Lock the admitted request until this write commits. A newer turn or expired session rolls it back. */
export async function guardSession(tx: Tx, ctx: HarnessCtx): Promise<number> {
  if (!ctx.sessionGuard) return ctx.userTurn;
  const [row] = await tx.select().from(sessions).where(eq(sessions.id, ctx.sessionId)).for("share");
  const [clock] = await tx.execute<{ expired: boolean }>(sql`select ${row?.expiresAt ?? null}::timestamptz <= clock_timestamp() as expired`);
  if (!row || row.userId !== ctx.userId || clock?.expired || (ctx.sessionGuard === "turn" && row.userTurn !== ctx.userTurn)) {
    throw new ArcieError("POLICY_DENIED", { spoken: "That request was interrupted. Please review the current card." });
  }
  return row.userTurn;
}

/** Starts a proposal: bumps the session's generation, marks it as preparing, and returns the new generation. */
export async function beginProposal(db: DbOrTx, sessionId: string): Promise<number> {
  const [row] = await db
    .insert(sessionState)
    .values({ sessionId, proposalGeneration: 1, preparingGeneration: 1 })
    .onConflictDoUpdate({
      target: sessionState.sessionId,
      set: {
        proposalGeneration: sql`${sessionState.proposalGeneration} + 1`,
        preparingGeneration: sql`${sessionState.proposalGeneration} + 1`,
      },
    })
    .returning({ generation: sessionState.proposalGeneration });
  return row!.generation;
}

/** The shared lock for mutations which may close an open review or change its event stream. */
export async function lockSessionState(tx: Tx, sessionId: string) {
  await tx.insert(sessionState).values({ sessionId }).onConflictDoNothing();
  const [row] = await tx.select().from(sessionState).where(eq(sessionState.sessionId, sessionId)).for("update");
  return row!;
}

export async function invalidateProposals(tx: Tx, sessionId: string) {
  await tx.update(sessionState).set({
    proposalGeneration: sql`${sessionState.proposalGeneration} + 1`,
    preparingGeneration: null,
  }).where(eq(sessionState.sessionId, sessionId));
}

/**
 * Cancel: invalidates any preparation in flight and runs `fn` under the same session_state row lock, so it
 * serializes with `publishProposal` (a card published first is visible to `fn`; a later publish is refused).
 * `fn` receives whether a preparation was in flight. Do not call the network inside `fn`.
 */
export async function cancelUnderLock<T>(db: Db, sessionId: string, fn: (tx: Tx, preparing: boolean) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    const row = await lockSessionState(tx, sessionId);
    await invalidateProposals(tx, sessionId);
    return fn(tx, row.preparingGeneration !== null);
  });
}

/**
 * Runs `fn` only if `generation` is still the session's current one, holding the session_state row lock so a
 * concurrent cancel or newer proposal waits. Returns `null` (and runs nothing) when the proposal was replaced.
 * Do not call the network inside `fn`.
 */
export async function publishProposal<T>(db: Db, sessionId: string, generation: number, fn: (tx: Tx) => Promise<T>): Promise<T | null> {
  return db.transaction(async (tx) => {
    const [row] = await tx.select().from(sessionState).where(eq(sessionState.sessionId, sessionId)).for("update");
    if (!row || row.proposalGeneration !== generation) return null;
    const out = await fn(tx);
    await tx.update(sessionState).set({ preparingGeneration: null }).where(eq(sessionState.sessionId, sessionId));
    return out;
  });
}

/** Clears the preparing marker if this proposal still owns it (a no-op once cancelled or replaced). */
export async function finishProposal(db: Db, sessionId: string, generation: number): Promise<void> {
  await db
    .update(sessionState)
    .set({ preparingGeneration: null })
    .where(and(eq(sessionState.sessionId, sessionId), eq(sessionState.preparingGeneration, generation)));
}

/**
 * Takes the intent's confirmation claim, or returns `null` while another instance holds a live one. A claim
 * expires `ttlMs` after it was taken and can then be taken over; both sides of that comparison use database
 * time (`clock_timestamp()`), never an instance clock. Returns the fencing token with the intent's revision at claim time.
 */
export async function claimConfirmation(db: Db, intentId: string, ttlMs = 30_000): Promise<{ token: string; revision: number } | null> {
  const token = randomUUID();
  return db.transaction(async (tx) => {
    const claimed = await tx
      .insert(confirmClaims)
      .values({ intentId, token, expiresAt: sql`clock_timestamp() + (${ttlMs} * interval '1 millisecond')` })
      .onConflictDoUpdate({
        target: confirmClaims.intentId,
        set: { token, expiresAt: sql`clock_timestamp() + (${ttlMs} * interval '1 millisecond')` },
        setWhere: sql`${confirmClaims.expiresAt} < clock_timestamp()`,
      })
      .returning({ token: confirmClaims.token });
    if (claimed.length === 0) return null;
    const [row] = await tx.select({ revision: intents.revision }).from(intents).where(eq(intents.id, intentId));
    return row ? { token, revision: row.revision } : null;
  });
}

/** Releases the claim only if `token` still owns it (a takeover by another instance is left alone). */
export async function releaseConfirmation(db: Db | Tx, intentId: string, token: string): Promise<void> {
  await db.delete(confirmClaims).where(and(eq(confirmClaims.intentId, intentId), eq(confirmClaims.token, token)));
}

const STALE_CONSENT = "The details changed. Please check the new card and confirm again.";

/**
 * Takes the user's budget lock: the first lock in the fixed order users row, session_state row, claim row, intent row. It is FOR NO
 * KEY UPDATE, not FOR UPDATE: that still serializes every budget locker (it conflicts with itself) but does not
 * conflict with the FOR KEY SHARE that foreign-key inserts (intents.user_id) take on the users row, so a
 * publish/cancel holding an intent row can't deadlock with an execution claim waiting on that intent.
 */
export async function lockUserBudget(tx: Tx, userId: string): Promise<void> {
  const rows = await tx.select({ id: users.id }).from(users).where(eq(users.id, userId)).for("no key update");
  if (rows.length === 0) throw new ArcieError("NOT_FOUND", { detail: { user: userId } });
}

export interface ClaimExecutionArgs {
  intentId: string;
  userId: string;
  /** The confirmation claim (fencing token and the revision the user saw). */
  token: string;
  revision: number;
  /** The `paramsHash` the confirmation was prepared against. */
  paramsHash: string;
  channel: Channel;
  userTurn: number;
  ctx: HarnessCtx;
  policy: PolicyProvider;
  /** Throws when the action is not allowed; receives the limits and spend read under the budget lock. */
  check: (limits: AgentLimits, spentTodayUsd: number) => void;
  onClaim: (tx: Tx) => Promise<void>;
}

/** Lock the lease before the intent so quote writes validate expiry after any row-lock wait. */
export async function lockConfirmRows(tx: Tx, intentId: string, token: string) {
  await tx.select({ token: confirmClaims.token }).from(confirmClaims)
    .where(and(eq(confirmClaims.intentId, intentId), eq(confirmClaims.token, token))).for("update");
  const [intent] = await tx.select().from(intents).where(eq(intents.id, intentId)).for("update");
  return intent;
}

/**
 * Moves an intent to `executing` under the user's budget lock, so intents of one user (in any session or on any
 * instance) can't both pass the daily limit, and limits are the ones in force at this moment. Lock order is
 * fixed: users row, session_state row, claim row, then intent row. Returns `false` when the
 * intent is no longer awaiting confirmation. Call inside one short transaction and never over a network call.
 */
export async function claimExecution(tx: Tx, a: ClaimExecutionArgs): Promise<boolean | "screen_only" | "stale_quote"> {
  await lockUserBudget(tx, a.userId);
  await lockSessionState(tx, a.ctx.sessionId);
  await tx.select({ token: confirmClaims.token }).from(confirmClaims)
    .where(and(eq(confirmClaims.intentId, a.intentId), eq(confirmClaims.token, a.token))).for("update");
  const limits = await a.policy.getLimits(a.userId, tx);
  const repo = new IntentRepo(tx);
  const spent = await repo.spentTodayUsd(a.userId, a.ctx.now());
  const [current] = await tx.select().from(intents).where(eq(intents.id, a.intentId)).for("update");
  await guardSession(tx, a.ctx);
  if (current?.status !== "awaiting_confirmation") return false;
  assertConfirmable(current, { channel: a.channel, userTurn: a.userTurn, now: a.ctx.now() });
  if (a.channel !== "screen" && current.params.recipientIsNew === true && limits.newRecipientRequiresScreen) return "screen_only";
  if (current.paramsHash !== a.paramsHash) throw new ArcieError("POLICY_DENIED", { spoken: STALE_CONSENT });
  a.check(limits, spent);
  // Atomic with the status change: token live and revision unchanged since the claim, or nothing executes.
  if (await repo.executeFenced(a.intentId, { token: a.token, revision: a.revision }, { confirmedVia: a.channel })) {
    await a.onClaim(tx);
    return true;
  }
  const [expiry] = await tx.execute<{ expired: boolean; staleQuote: boolean }>(sql`select
    ${current.expiresAt}::timestamptz <= clock_timestamp() as expired,
    ${current.quoteAt}::timestamptz < clock_timestamp() - ${QUOTE_FRESH_MS} * interval '1 millisecond' as "staleQuote"`);
  if (expiry?.expired) throw new ArcieError("QUOTE_EXPIRED");
  if (current.kind === "swap" && expiry?.staleQuote) return "stale_quote";
  throw new ArcieError("POLICY_DENIED", { spoken: STALE_CONSENT });
}
