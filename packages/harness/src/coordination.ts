import { confirmClaims, intents, sessionState, type Db, type Tx } from "@arcie/db";
import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";

/**
 * Cross-instance proposal coordination. A proposal's slow preparation (Circle/estimate calls) runs outside
 * any transaction; only publishing takes a row lock on `session_state`, so a cancel or a newer proposal on
 * any server instance makes a stale preparation write nothing.
 */

/** Starts a proposal: bumps the session's generation, marks it as preparing, and returns the new generation. */
export async function beginProposal(db: Db, sessionId: string): Promise<number> {
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

/**
 * Cancel: invalidates any preparation in flight and runs `fn` under the same session_state row lock, so it
 * serializes with `publishProposal` (a card published first is visible to `fn`; a later publish is refused).
 * `fn` receives whether a preparation was in flight. Do not call the network inside `fn`.
 */
export async function cancelUnderLock<T>(db: Db, sessionId: string, fn: (tx: Tx, preparing: boolean) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.insert(sessionState).values({ sessionId }).onConflictDoNothing();
    const [row] = await tx.select().from(sessionState).where(eq(sessionState.sessionId, sessionId)).for("update");
    await tx
      .update(sessionState)
      .set({ proposalGeneration: row!.proposalGeneration + 1, preparingGeneration: null })
      .where(eq(sessionState.sessionId, sessionId));
    return fn(tx, row!.preparingGeneration !== null);
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
 * time (`now()`), never an instance clock. Returns the fencing token with the intent's revision at claim time.
 */
export async function claimConfirmation(db: Db, intentId: string, ttlMs = 30_000): Promise<{ token: string; revision: number } | null> {
  const token = randomUUID();
  return db.transaction(async (tx) => {
    const claimed = await tx
      .insert(confirmClaims)
      .values({ intentId, token, expiresAt: sql`now() + (${ttlMs} * interval '1 millisecond')` })
      .onConflictDoUpdate({
        target: confirmClaims.intentId,
        set: { token, expiresAt: sql`now() + (${ttlMs} * interval '1 millisecond')` },
        setWhere: sql`${confirmClaims.expiresAt} < now()`,
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
