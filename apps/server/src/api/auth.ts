import { getAddress } from "viem";
import { Hono } from "hono";
import { sessions } from "@arcie/db";
import { and, eq, gt } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import type { AppDeps } from "../app.js";
import { mintVoiceSession } from "../auth/identify.js";
import { AuthError } from "../auth/errors.js";

export function authRoutes(deps: AppDeps) {
  const app = new Hono();

  /** Call right after login: idempotent onboarding (user, limits, Circle wallet, welcome drip). */
  app.post("/auth/session", async (c) => {
    const identity = await deps.identify(c);
    const r = await deps.onboard(identity);
    return c.json({
      user: { id: r.user.id, displayName: r.user.displayName, email: r.user.email, linkedWallet: r.user.linkedWallet },
      wallet: { address: getAddress(r.wallet.address), chain: r.wallet.chain },
      limits: r.limits,
      dripTx: r.dripTx,
    });
  });

  /** Before starting ElevenLabs: a session id bound to this user, passed as the custom-LLM extra body session_id. */
  app.post("/voice/session", async (c) => {
    const { userId } = await deps.identify(c);
    return c.json(mintVoiceSession(deps.db, userId));
  });

  app.post("/voice/conversation", async (c) => {
    const { userId } = await deps.identify(c);
    const sessionId = c.req.header("x-arcie-session");
    if (!sessionId) throw new AuthError("Open voice from your wallet to connect.");
    const conversationId = randomUUID();
    const updated = deps.db.update(sessions).set({ conversationId, conversationStartTurn: sessions.userTurn })
      .where(and(eq(sessions.id, sessionId), eq(sessions.userId, userId), gt(sessions.expiresAt, new Date().toISOString())))
      .run();
    if (!updated.changes) throw new AuthError("Your wallet session expired. Reconnect to use voice.");
    return c.json({ conversationId });
  });

  return app;
}
