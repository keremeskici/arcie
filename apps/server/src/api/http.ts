import { ArcieError, type ErrorCode } from "@arcie/core";
import { sessions } from "@arcie/db";
import type { HarnessCtx } from "@arcie/harness";
import { eq } from "drizzle-orm";
import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { randomUUID } from "node:crypto";
import type { AppDeps } from "../app.js";
import { AuthError } from "../auth/errors.js";

export { AuthError };

const STATUS: Partial<Record<ErrorCode, ContentfulStatusCode>> = {
  NOT_FOUND: 404,
  QUOTE_EXPIRED: 409,
  POLICY_DENIED: 400,
  INSUFFICIENT_BALANCE: 400,
  INVALID_AMOUNT: 400,
  INVALID_RECIPIENT: 400,
  VAULT_UNAVAILABLE: 400,
  SLIPPAGE_EXCEEDED: 409,
  RPC_UNAVAILABLE: 502,
  CIRCLE_API_ERROR: 502,
  ONRAMP_ERROR: 502,
  UNKNOWN: 500,
};

/** One error shape for every route: { error: { code, message } }. */
export function errorResponse(c: Context, e: unknown) {
  if (e instanceof AuthError) return c.json({ error: { code: e.code, message: e.message } }, 401);
  if (e instanceof ArcieError) {
    const alreadyHandled = (e.detail as { alreadyHandled?: boolean } | undefined)?.alreadyHandled;
    return c.json({ error: { code: e.code, message: e.spoken } }, alreadyHandled ? 409 : (STATUS[e.code] ?? 500));
  }
  console.error(e);
  return c.json({ error: { code: "UNKNOWN", message: "Something went wrong on my side." } }, 500);
}

export function errorFor(code: string, message: string, status: ContentfulStatusCode) {
  return (c: Context) => c.json({ error: { code, message } }, status);
}

/** Builds the harness context for a tapped (screen) request. */
export async function screenCtx(deps: AppDeps, c: Context): Promise<HarnessCtx> {
  const { userId } = await deps.identify(c);
  const sessionId = c.req.header("x-arcie-session") ?? `default:${userId}`;
  const row = deps.db.select().from(sessions).where(eq(sessions.id, sessionId)).get();
  // A session id is a capability: never let one user act inside another user's session.
  if (row && row.userId !== userId) throw new AuthError("That session belongs to someone else.");
  return { userId, sessionId, channel: "screen", userTurn: row?.userTurn ?? 0, now: () => new Date(), runId: randomUUID() };
}
