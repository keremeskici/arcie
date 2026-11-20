import type { ActionKind, ChainId, ReceiptIsland } from "@arcie/core";
import { intents, type DbOrTx, type IntentStatus } from "@arcie/db";
import { and, desc, eq, gte, ne, or } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { paramsHash } from "./hash.js";

export type { IntentStatus } from "@arcie/db";
export type Intent = typeof intents.$inferSelect;
type IntentPatch = Partial<Omit<Intent, "id" | "status" | "createdAt">>;

export interface IntentDraft {
  /** Lets the caller reference the id (e.g. as `supersededBy`) before the row exists. */
  id?: string;
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
  constructor(private readonly db: DbOrTx) {}

  async create(d: IntentDraft): Promise<Intent> {
    const now = d.now.toISOString();
    const [row] = await this.db
      .insert(intents)
      .values({
        id: d.id ?? randomUUID(),
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
      .returning();
    return row!;
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
  async transition(id: string, from: IntentStatus, to: IntentStatus, patch: IntentPatch = {}): Promise<boolean> {
    const res = await this.db
      .update(intents)
      .set({ ...patch, status: to, updatedAt: new Date().toISOString() })
      .where(and(eq(intents.id, id), eq(intents.status, from)))
      .returning({ id: intents.id });
    return res.length === 1;
  }

  /** Updates fields without changing status (e.g. a refreshed quote). */
  async patch(id: string, patch: IntentPatch): Promise<void> {
    await this.db.update(intents).set({ ...patch, updatedAt: new Date().toISOString() }).where(eq(intents.id, id));
  }

  /** Cancels every other awaiting intent in the session (only one Confirm island is ever open); returns their ids. */
  async supersedeOpen(sessionId: string, newIntentId: string): Promise<string[]> {
    const rows = await this.db
      .select({ id: intents.id })
      .from(intents)
      .where(and(eq(intents.sessionId, sessionId), eq(intents.status, "awaiting_confirmation")));
    const superseded: string[] = [];
    for (const r of rows) {
      if (r.id === newIntentId) continue;
      if (await this.transition(r.id, "awaiting_confirmation", "cancelled", { statusReason: "superseded", supersededBy: newIntentId })) superseded.push(r.id);
    }
    return superseded;
  }

  /** Latest awaiting intent in the session, even if its TTL passed (so a late "yes" gets QUOTE_EXPIRED, not NOT_FOUND). */
  latestAwaiting(sessionId: string): Promise<Intent | null> {
    return this.openForSession(sessionId, new Date(0));
  }

  async latestReceiptForSession(sessionId: string): Promise<ReceiptIsland | null> {
    const [row] = await this.db.select().from(intents)
      .where(and(eq(intents.sessionId, sessionId), or(eq(intents.status, "succeeded"), eq(intents.status, "failed"))))
      .orderBy(desc(intents.updatedAt)).limit(1);
    return (row?.preview?.receipt as ReceiptIsland | undefined) ?? null;
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
