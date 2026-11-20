import { HOME_CHAIN } from "@arcie/appkit";
import { ArcieError } from "@arcie/core";
import { sessions, users, wallets } from "@arcie/db";
import { DbPolicyProvider } from "@arcie/harness";
import { and, eq, isNull, sql } from "drizzle-orm";
import { Hono } from "hono";
import { randomUUID } from "node:crypto";
import { getAddress } from "viem";
import type { AppDeps } from "../create-app.js";
import { mintVoiceSession } from "../auth/identify.js";
import { AuthError } from "../auth/errors.js";

export function authRoutes(deps: AppDeps) {
  const app = new Hono();

  async function existingDemoAccount() {
    const [account] = await deps.db
      .select({
        user: { id: users.id, displayName: users.displayName, email: users.email, linkedWallet: users.linkedWallet },
        wallet: { address: wallets.address, chain: wallets.chain },
      })
      .from(users)
      .innerJoin(wallets, and(eq(wallets.userId, users.id), eq(wallets.chain, HOME_CHAIN)))
      .where(and(eq(users.id, deps.demoUserId), eq(users.homeChain, HOME_CHAIN), isNull(users.email), isNull(users.linkedWallet)))
      .limit(1);
    if (!account) throw new ArcieError("NOT_FOUND", { spoken: "The demo wallet is temporarily unavailable." });
    return { ...account, wallet: { ...account.wallet, address: getAddress(account.wallet.address) } };
  }

  app.post("/auth/demo", async (c) => {
    if (!deps.demoWalletAuth) return c.notFound();
    await existingDemoAccount();
    c.header("Cache-Control", "no-store");
    return c.json(deps.demoWalletAuth.issue());
  });

  /** Call right after login: idempotent onboarding (user, limits, Circle wallet, welcome drip). */
  app.post("/auth/session", async (c) => {
    const identity = await deps.identify(c);
    if (identity.demoWallet) {
      const account = await existingDemoAccount();
      const limits = await new DbPolicyProvider(deps.db).getLimits(identity.userId);
      return c.json({ ...account, limits, dripTx: null });
    }
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
    const { userId, demoWallet } = await deps.identify(c);
    return c.json(await mintVoiceSession(deps.db, userId, demoWallet?.expiresAt));
  });

  app.post("/voice/conversation", async (c) => {
    const { userId } = await deps.identify(c);
    const sessionId = c.req.header("x-arcie-session");
    if (!sessionId) throw new AuthError("Open voice from your wallet to connect.");
    const conversationId = randomUUID();
    // Advance the durable turn fence before the replacement receives its first model request.
    const startTurn = sql`${sessions.userTurn} + case when ${sessions.userTurn} > 0 or ${sessions.conversationId} is not null then 1 else 0 end`;
    const updated = await deps.db.update(sessions)
      .set({ conversationId, conversationStartTurn: startTurn, userTurn: startTurn })
      .where(and(eq(sessions.id, sessionId), eq(sessions.userId, userId), sql`${sessions.expiresAt}::timestamptz > clock_timestamp()`))
      .returning({ id: sessions.id });
    if (updated.length === 0) throw new AuthError("Your wallet session expired. Reconnect to use voice.");
    return c.json({ conversationId });
  });

  return app;
}
