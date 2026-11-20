import { Hono } from "hono";
import type { AppDeps } from "../app.js";
import { mintVoiceSession } from "../auth/identify.js";

export function authRoutes(deps: AppDeps) {
  const app = new Hono();

  /** Call right after login: idempotent onboarding (user, limits, Circle wallet, welcome drip). */
  app.post("/auth/session", async (c) => {
    const identity = await deps.identify(c);
    const r = await deps.onboard(identity);
    return c.json({
      user: { id: r.user.id, displayName: r.user.displayName, email: r.user.email, linkedWallet: r.user.linkedWallet },
      wallet: { address: r.wallet.address, chain: r.wallet.chain },
      limits: r.limits,
      dripTx: r.dripTx,
    });
  });

  /** Before starting ElevenLabs: a session id bound to this user, passed as the custom-LLM extra body session_id. */
  app.post("/voice/session", async (c) => {
    const { userId } = await deps.identify(c);
    return c.json(await mintVoiceSession(deps.db, userId));
  });

  return app;
}
