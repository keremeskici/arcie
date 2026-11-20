import type { ActionKind, ChainId, ConfirmIsland, ProcessingIsland, ReceiptIsland } from "@arcie/core";
import { confirmClaims, intents, type DbOrTx, type IntentStatus } from "@arcie/db";
import { and, desc, eq, gte, inArray, isNull, ne, or, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { savedReview } from "../disclosure/savings.js";
import { paramsHash } from "./hash.js";

export const QUOTE_FRESH_MS = 30_000;

export type { IntentStatus } from "@arcie/db";
export type Intent = typeof intents.$inferSelect;
/** Older stored cards lack a revision; redisplay them with their durable version before asking for a tap. */
export function savedCard(intent: Intent): ConfirmIsland | undefined {
  return savedReview(intent) ?? undefined;
}

export function savedProcessing(intent: Intent): ProcessingIsland | undefined {
  if (intent.status !== "executing") return undefined;
  return {
    kind: "processing", intentId: intent.id,
    ...(intent.statusReason === "submission_unknown" ? { unverified: true as const } : {}),
    ...(intent.error ? { summary: intent.error.message } : {}),
  };
}

type IntentPatch = Partial<Omit<Intent, "id" | "status" | "createdAt" | "revision">>;

/** Changes to what the user consented to bump `revision` (in SQL, so concurrent writers can't lose an increment). */
const REVISED_FIELDS = ["params", "paramsHash", "preview", "expiresAt"] as const;
const revisionBump = (patch: IntentPatch) =>
  REVISED_FIELDS.some((k) => k in patch) ? { revision: sql`${intents.revision} + 1` } : {};

export interface IntentDraft {
  /** Lets the caller reference the id (e.g. as `supersededBy`) before the row exists. */
  id?: string;
  confirmedVia?: Intent["confirmedVia"];
  error?: Intent["error"];
  sessionId: string;
  userId: string;
  kind: ActionKind;
  chain: ChainId;
  params: Record<string, unknown>;
  preview: Record<string, unknown>;
  status: IntentStatus;
  statusReason?: string | null;
  usdValue: string;
  previewTurn: number;
  now: Date;
  ttlSec: number | null;
}

export class IntentRepo {
  constructor(private readonly db: DbOrTx) {}

  private insert(d: IntentDraft) {
    const now = d.now.toISOString();
    return this.db
      .insert(intents)
      .values({
        id: d.id ?? randomUUID(),
        confirmedVia: d.confirmedVia ?? null,
        error: d.error ?? null,
        sessionId: d.sessionId,
        userId: d.userId,
        kind: d.kind,
        chain: d.chain,
        params: d.params,
        paramsHash: paramsHash(d.params),
        preview: d.preview,
        status: d.status,
        statusReason: d.statusReason ?? null,
        usdValue: d.usdValue,
        previewTurn: d.previewTurn,
        quoteAt: now,
        createdAt: now,
        updatedAt: now,
        expiresAt: d.ttlSec === null ? null : new Date(d.now.getTime() + d.ttlSec * 1000).toISOString(),
      });
  }

  async create(d: IntentDraft): Promise<Intent> {
    const [row] = await this.insert(d).returning();
    return row!;
  }

  async createIfAbsent(d: IntentDraft & { id: string }): Promise<Intent | null> {
    const [row] = await this.insert(d).onConflictDoNothing({ target: intents.id }).returning();
    return row ?? null;
  }

  async get(id: string): Promise<Intent | null> {
    return (await this.db.select().from(intents).where(eq(intents.id, id)).limit(1))[0] ?? null;
  }

  /** The session's intent awaiting confirmation that hasn't expired yet. */
  async openForSession(sessionId: string, now: Date): Promise<Intent | null> {
    const rows = await this.db
      .select()
      .from(intents)
      .where(and(eq(intents.sessionId, sessionId), eq(intents.status, "awaiting_confirmation")));
    const open = rows.filter((r) => !r.expiresAt || r.expiresAt > now.toISOString());
    return open.sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ?? null;
  }

  /** Compare-and-set: returns false if the intent wasn't in `from` (someone else moved it first). */
  async transition(id: string, from: IntentStatus, to: IntentStatus, patch: IntentPatch = {}, observed?: { txHash: string | null; revision?: number }): Promise<boolean> {
    const res = await this.db
      .update(intents)
      .set({ ...patch, ...revisionBump(patch), status: to, updatedAt: new Date().toISOString() })
      .where(and(eq(intents.id, id), eq(intents.status, from),
        observed ? (observed.txHash === null ? isNull(intents.txHash) : eq(intents.txHash, observed.txHash)) : undefined,
        observed?.revision !== undefined ? eq(intents.revision, observed.revision) : undefined))
      .returning({ id: intents.id });
    return res.length === 1;
  }

  /** Updates fields without changing status (e.g. a refreshed quote). */
  async patch(id: string, patch: IntentPatch): Promise<void> {
    await this.db.update(intents).set({ ...patch, ...revisionBump(patch), updatedAt: new Date().toISOString() }).where(eq(intents.id, id));
  }

  /** Awaiting, same revision the caller saw, and the caller's claim token still live (database time). */
  private fence(id: string, expected: { token: string; revision: number }) {
    return and(
      eq(intents.id, id),
      eq(intents.status, "awaiting_confirmation"),
      eq(intents.revision, expected.revision),
      sql`(${intents.expiresAt} is null or ${intents.expiresAt}::timestamptz > clock_timestamp())`,
      sql`exists (select 1 from ${confirmClaims} where ${confirmClaims.intentId} = ${intents.id} and ${confirmClaims.token} = ${expected.token} and ${confirmClaims.expiresAt} > clock_timestamp())`,
    );
  }

  /**
   * Fenced update for the confirm path: writes only while the intent is still awaiting confirmation, the caller's
   * claim token is live (database time) and the revision is the one the caller saw. Increments the revision.
   */
  async patchFenced(id: string, expected: { token: string; revision: number }, patch: IntentPatch): Promise<boolean> {
    const res = await this.db
      .update(intents)
      .set({ ...patch, revision: sql`${intents.revision} + 1`, updatedAt: new Date().toISOString() })
      .where(this.fence(id, expected))
      .returning({ id: intents.id });
    return res.length === 1;
  }

  /** Same fence, but for a field that is not part of what the user consented to (e.g. `quoteAt`): no revision bump. */
  async touchFenced(id: string, expected: { token: string; revision: number }, patch: Pick<IntentPatch, "quoteAt">): Promise<boolean> {
    const res = await this.db
      .update(intents)
      .set({ ...patch, updatedAt: new Date().toISOString() })
      .where(this.fence(id, expected))
      .returning({ id: intents.id });
    return res.length === 1;
  }

  /** The awaiting -> executing step under the same fence, so stale consent can't start execution. */
  async executeFenced(id: string, expected: { token: string; revision: number }, patch: IntentPatch = {}): Promise<boolean> {
    const res = await this.db
      .update(intents)
      .set({ ...patch, ...revisionBump(patch), status: "executing", updatedAt: new Date().toISOString() })
      .where(and(this.fence(id, expected), sql`(${intents.kind} <> 'swap' or ${intents.quoteAt} is null
        or ${intents.quoteAt}::timestamptz >= clock_timestamp() - ${QUOTE_FRESH_MS} * interval '1 millisecond')`))
      .returning({ id: intents.id });
    return res.length === 1;
  }

  /** Cancels every other awaiting intent in the session (only one Confirm island is ever open); returns their ids. */
  async supersedeOpen(sessionId: string, newIntentId?: string): Promise<string[]> {
    const rows = await this.db
      .select({ id: intents.id })
      .from(intents)
      .where(and(eq(intents.sessionId, sessionId), eq(intents.status, "awaiting_confirmation")));
    const superseded: string[] = [];
    for (const r of rows) {
      if (r.id === newIntentId) continue;
      if (await this.transition(r.id, "awaiting_confirmation", "cancelled", { statusReason: "superseded", supersededBy: newIntentId ?? null })) superseded.push(r.id);
    }
    return superseded;
  }

  /** Latest awaiting intent in the session, even if its TTL passed (so a late "yes" gets QUOTE_EXPIRED, not NOT_FOUND). */
  latestAwaiting(sessionId: string): Promise<Intent | null> {
    return this.openForSession(sessionId, new Date(0));
  }

  async latestExecutionForSession(sessionId: string): Promise<ProcessingIsland | ReceiptIsland | null> {
    const [row] = await this.db.select().from(intents)
      .where(and(eq(intents.sessionId, sessionId), inArray(intents.status, ["executing", "succeeded", "failed"])))
      .orderBy(desc(intents.updatedAt)).limit(1);
    return row ? savedProcessing(row) ?? (row.preview?.receipt as ReceiptIsland | undefined) ?? null : null;
  }

  /** Outflows only: withdrawals from the user's own vault back to their wallet don't use up limits. */
  async spentTodayUsd(userId: string, now: Date): Promise<number> {
    const since = new Date(now.getTime() - 24 * 3600_000).toISOString();
    const rows = await this.db
      .select({ usdValue: intents.usdValue })
      .from(intents)
      .where(and(eq(intents.userId, userId), ne(intents.kind, "earn_withdraw"), or(
        and(eq(intents.status, "succeeded"), gte(intents.createdAt, since)),
        eq(intents.status, "executing"),
        eq(intents.statusReason, "submission_unknown"),
      )));
    return rows.reduce((sum, r) => sum + Number(r.usdValue ?? 0), 0);
  }

  async listForUser(userId: string, limit: number): Promise<Intent[]> {
    const rows = await this.db
      .select()
      .from(intents)
      .where(eq(intents.userId, userId));
    return rows
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit);
  }
}
