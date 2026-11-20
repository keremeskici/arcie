import { audit as auditTable, type Db } from "@arcie/db";
import type { HarnessCtx } from "./context.js";

/** Append-only record of tool calls, policy decisions, transitions and tx hashes. */
export function audit(db: Db, ctx: HarnessCtx, type: string, payload: object, intentId?: string): void {
  db.insert(auditTable)
    .values({ userId: ctx.userId, sessionId: ctx.sessionId, intentId: intentId ?? null, type, payload, createdAt: ctx.now().toISOString() })
    .run();
}
