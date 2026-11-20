import { audit as auditTable, type DbOrTx } from "@arcie/db";
import type { HarnessCtx } from "./context.js";

/** Append-only record of tool calls, policy decisions, transitions and tx hashes. */
export async function audit(db: DbOrTx, ctx: HarnessCtx, type: string, payload: object, intentId?: string): Promise<void> {
  await db.insert(auditTable)
    .values({ userId: ctx.userId, sessionId: ctx.sessionId, intentId: intentId ?? null, type, payload, createdAt: ctx.now().toISOString() });
}
