import { savedProcessing, savedReview } from "@arcie/harness";
import { ArcieError, type ActionKind } from "@arcie/core";
import { confirmClaims } from "@arcie/db";
import { and, eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import type { AppDeps } from "../create-app.js";
import { refreshIntentStatus } from "../reconcile.js";
import { screenCtx } from "./http.js";

const proposeBody = z.object({
  kind: z.enum(["send", "swap", "earn_deposit", "earn_withdraw"]),
  params: z.record(z.string(), z.unknown()),
});

const currency = z.enum(["USDC", "EURC", "cirBTC"]);
const screenSwapBody = z.strictObject({
  requestId: z.uuid(), tokenIn: currency, tokenOut: currency,
  amountIn: z.string().min(1).max(80), minOut: z.string().min(1).max(80),
});

/** Tapped actions go through exactly the same harness as voice. */
export function intentRoutes(deps: AppDeps) {
  const app = new Hono();

  app.post("/swaps", async (c) => {
    const ctx = await screenCtx(deps, c);
    const parsed = screenSwapBody.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: { code: "INVALID_ARGS", message: "Check the currencies, amount and quote." } }, 400);
    return c.json(await deps.harness.screenSwap(ctx, parsed.data));
  });

  app.post("/intents", async (c) => {
    const parsed = proposeBody.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: { code: "INVALID_ARGS", message: "Unknown action or missing params." } }, 400);
    const ctx = await screenCtx(deps, c);
    const r = await deps.harness.propose(ctx, parsed.data.kind as ActionKind, parsed.data.params);
    const err = (r.data as { error?: string } | undefined)?.error;
    if (err) return c.json({ error: { code: err, message: r.summary }, intentId: (r.data as { intentId?: string }).intentId ?? null }, 400);
    return c.json({ summary: r.summary, island: r.island, data: r.data });
  });

  app.get("/intents/:id", async (c) => {
    const ctx = await screenCtx(deps, c);
    const stored = await deps.harness.intents.get(c.req.param("id"));
    if (!stored || stored.userId !== ctx.userId) throw new ArcieError("NOT_FOUND");
    const i = await refreshIntentStatus(deps, stored);
    const expired = i.status === "awaiting_confirmation" && i.expiresAt !== null && i.expiresAt <= ctx.now().toISOString();
    const status = expired ? "expired" : i.status;
    const canReview = status === "awaiting_confirmation" && i.sessionId === ctx.sessionId;
    const checking = status === "awaiting_confirmation" && (await deps.db.select({ id: confirmClaims.intentId }).from(confirmClaims)
      .where(and(eq(confirmClaims.intentId, i.id), sql`${confirmClaims.expiresAt} > clock_timestamp()`)).limit(1)).length > 0;
    // The unscoped owner poll also recovers revised terms when its event stream reconnects.
    const recoverReview = status === "awaiting_confirmation" && c.req.header("x-arcie-session") === undefined;
    const island = i.status === "succeeded" || i.status === "failed"
      ? i.preview?.receipt ?? null
      : savedProcessing(i) ?? (canReview || recoverReview ? savedReview(i) : null);
    return c.json({
      ...(checking ? { checking: true } : {}),
      id: i.id,
      kind: i.kind,
      status,
      canReview,
      statusReason: i.statusReason,
      txHash: i.txHash,
      expiresAt: i.expiresAt,
      island,
      error: i.error,
    });
  });

  app.post("/intents/:id/confirm", async (c) => {
    const ctx = await screenCtx(deps, c);
    const body = await c.req.text();
    let revision: number | undefined;
    if (body) {
      let json: unknown;
      try { json = JSON.parse(body); } catch { json = null; }
      const parsed = z.object({ revision: z.number().int().nonnegative().optional() }).safeParse(json);
      if (!parsed.success) return c.json({ error: { code: "INVALID_ARGS", message: "Invalid confirmation." } }, 400);
      revision = parsed.data.revision;
    }
    const r = await deps.harness.confirm(ctx, c.req.param("id"), "screen", revision);
    return c.json(r);
  });

  app.post("/intents/:id/cancel", async (c) => {
    const ctx = await screenCtx(deps, c);
    const i = await deps.harness.intents.get(c.req.param("id"));
    if (!i || i.userId !== ctx.userId) throw new ArcieError("NOT_FOUND");
    const r = await deps.harness.cancel(ctx, i.id);
    return c.json({ summary: r.summary, ...(r.data as object) });
  });

  return app;
}
