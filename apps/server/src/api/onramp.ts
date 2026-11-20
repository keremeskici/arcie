import { Hono } from "hono";
import { z } from "zod";
import type { AppDeps } from "../app.js";
import { screenCtx } from "./http.js";

const eventBody = z.object({ type: z.enum(["submitted", "settled", "failed"]), payload: z.unknown().optional() });
const sessionBody = z.object({ amount: z.string().optional(), token: z.enum(["USDC", "EURC"]).optional(), requestId: z.string().uuid().optional() });

export function onrampRoutes(deps: AppDeps) {
  const app = new Hono();

  /** Button path for "Add money": the same start_onramp tool the agent uses. */
  app.post("/onramp/sessions", async (c) => {
    const ctx = await screenCtx(deps, c);
    const body = sessionBody.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: { code: "INVALID_ARGS", message: "Invalid checkout request." } }, 400);
    const r = await deps.harness.runTool({ ...ctx, onrampRequestId: body.data.requestId }, "start_onramp", body.data);
    c.header("Cache-Control", "no-store");
    const err = (r.data as { error?: string } | undefined)?.error;
    if (err) return c.json({ error: { code: err, message: r.summary } }, err === "ONRAMP_ERROR" || err === "CIRCLE_API_ERROR" ? 502 : 400);
    return c.json({ island: r.island, summary: r.summary });
  });

  /** The client forwards the widget's lifecycle callbacks here. */
  app.post("/onramp/events", async (c) => {
    const ctx = await screenCtx(deps, c);
    const parsed = eventBody.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: { code: "INVALID_ARGS", message: "Unknown onramp event." } }, 400);
    await deps.harness.recordOnrampEvent(ctx, { type: parsed.data.type, payload: parsed.data.payload ?? null });
    return c.json({ ok: true });
  });

  return app;
}
