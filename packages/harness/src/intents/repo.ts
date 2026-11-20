import type { ActionKind, ChainId, ReceiptIsland } from "@arcie/core";
import { intents, type Db, type IntentStatus } from "@arcie/db";
import { and, desc, eq, gte, ne, or } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { paramsHash } from "./hash.js";

export type { IntentStatus } from "@arcie/db";
export type Intent = typeof intents.$inferSelect;
type IntentPatch = Partial<Omit<Intent, "id" | "status" | "createdAt">>;

export interface IntentDraft {
  sessionId: string;
  userId: string;
  kind: ActionKind;
  chain: ChainId;
  params: Record<string, unknown>;
  preview: Record<string, unknown>;
  status: IntentStatus;
  statusReason?: string;
  usdValue: string;
  previewTurn: number;
  now: Date;
  ttlSec: number;
}

export class IntentRepo {
  constructor(private readonly db: Db) {}

  create(d: IntentDraft): Intent {
    const now = d.now.toISOString();
    return this.db
      .insert(intents)
      .values({
        id: randomUUID(),
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
        expiresAt: new Date(d.now.getTime() + d.ttlSec * 1000).toISOString(),
      })
      .returning()
      .get();
  }

  get(id: string): Intent | null {
    return this.db.select().from(intents).where(eq(intents.id, id)).get() ?? null;
  }

  /** The session's intent awaiting confirmation that hasn't expired yet. */
  openForSession(sessionId: string, now: Date): Intent | null {
    const rows = this.db
      .select()
      .from(intents)
      .where(and(eq(intents.sessionId, sessionId), eq(intents.status, "awaiting_confirmation")))
      .all();
    const open = rows.filter((r) => !r.expiresAt || r.expiresAt > now.toISOString());
    return open.sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ?? null;
  }

  /** Compare-and-set: returns false if the intent wasn't in `from` (someone else moved it first). */
  transition(id: string, from: IntentStatus, to: IntentStatus, patch: IntentPatch = {}): boolean {
    const res = this.db
      .update(intents)
      .set({ ...patch, status: to, updatedAt: new Date().toISOString() })
      .where(and(eq(intents.id, id), eq(intents.status, from)))
      .run();
    return res.changes === 1;
  }

  /** Updates fields without changing status (e.g. a refreshed quote). */
  patch(id: string, patch: IntentPatch): void {
    this.db.update(intents).set({ ...patch, updatedAt: new Date().toISOString() }).where(eq(intents.id, id)).run();
  }

  /** Cancels every other awaiting intent in the session (only one Confirm island is ever open); returns their ids. */
  supersedeOpen(sessionId: string, newIntentId: string): string[] {
    const rows = this.db
      .select({ id: intents.id })
      .from(intents)
      .where(and(eq(intents.sessionId, sessionId), eq(intents.status, "awaiting_confirmation")))
      .all();
    return rows
      .filter((r) => r.id !== newIntentId)
      .filter((r) => this.transition(r.id, "awaiting_confirmation", "cancelled", { statusReason: "superseded", supersededBy: newIntentId }))
      .map((r) => r.id);
  }

  /** Latest awaiting intent in the session, even if its TTL passed (so a late "yes" gets QUOTE_EXPIRED, not NOT_FOUND). */
  latestAwaiting(sessionId: string): Intent | null {
    return this.openForSession(sessionId, new Date(0));
  }

  latestReceiptForSession(sessionId: string): ReceiptIsland | null {
    const row = this.db.select().from(intents)
      .where(and(eq(intents.sessionId, sessionId), or(eq(intents.status, "succeeded"), eq(intents.status, "failed"))))
      .orderBy(desc(intents.updatedAt)).limit(1).get();
    return (row?.preview?.receipt as ReceiptIsland | undefined) ?? null;
  }

  /** Outflows only: withdrawals from the user's own vault back to their wallet don't use up limits. */
  spentTodayUsd(userId: string, now: Date): number {
    const since = new Date(now.getTime() - 24 * 3600_000).toISOString();
    return this.db
      .select({ usdValue: intents.usdValue })
      .from(intents)
      .where(and(eq(intents.userId, userId), ne(intents.kind, "earn_withdraw"), or(
        and(eq(intents.status, "succeeded"), gte(intents.createdAt, since)),
        eq(intents.status, "executing"),
        eq(intents.statusReason, "submission_unknown"),
      )))
      .all()
      .reduce((sum, r) => sum + Number(r.usdValue ?? 0), 0);
  }

  listForUser(userId: string, limit: number): Intent[] {
    return this.db
      .select()
      .from(intents)
      .where(eq(intents.userId, userId))
      .all()
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit);
  }
}
