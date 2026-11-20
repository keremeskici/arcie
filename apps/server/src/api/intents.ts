import { ArcieError, type ActionKind } from "@arcie/core";
import { Hono } from "hono";
import { z } from "zod";
import type { AppDeps } from "../app.js";
import { screenCtx } from "./http.js";

const proposeBody = z.object({
  kind: z.enum(["send", "swap", "earn_deposit", "earn_withdraw"]),
  params: z.record(z.string(), z.unknown()),
});

/** Tapped actions go through exactly the same harness as voice. */
export function intentRoutes(deps: AppDeps) {
  const app = new Hono();

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
    const i = deps.harness.intents.get(c.req.param("id"));
    if (!i || i.userId !== ctx.userId) throw new ArcieError("NOT_FOUND");
    return c.json({
      id: i.id,
      kind: i.kind,
      status: i.status,
      statusReason: i.statusReason,
      txHash: i.txHash,
      expiresAt: i.expiresAt,
      island: i.status === "succeeded" || i.status === "failed"
        ? i.preview?.receipt ?? null
        : i.status === "awaiting_confirmation" ? i.preview?.island ?? null : null,
      error: i.error,
    });
  });

  app.post("/intents/:id/confirm", async (c) => {
    const ctx = await screenCtx(deps, c);
    const r = await deps.harness.confirm(ctx, c.req.param("id"), "screen");
    return c.json(r);
  });

  app.post("/intents/:id/cancel", async (c) => {
    const ctx = await screenCtx(deps, c);
    const i = deps.harness.intents.get(c.req.param("id"));
    if (!i || i.userId !== ctx.userId) throw new ArcieError("NOT_FOUND");
    const r = await deps.harness.cancel(ctx, i.id);
    return c.json({ summary: r.summary, ...(r.data as object) });
  });

  return app;
}
