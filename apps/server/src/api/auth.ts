import { HOME_CHAIN } from "@arcie/appkit";
import { ArcieError } from "@arcie/core";
import { users, wallets } from "@arcie/db";
import { DbPolicyProvider } from "@arcie/harness";
import { and, eq, isNull } from "drizzle-orm";
import { Hono } from "hono";
import type { AppDeps } from "../create-app.js";
import { mintVoiceSession } from "../auth/identify.js";

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
    return account;
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
      wallet: { address: r.wallet.address, chain: r.wallet.chain },
      limits: r.limits,
      dripTx: r.dripTx,
    });
  });

  /** Before starting ElevenLabs: a session id bound to this user, passed as the custom-LLM extra body session_id. */
  app.post("/voice/session", async (c) => {
    const { userId, demoWallet } = await deps.identify(c);
    return c.json(await mintVoiceSession(deps.db, userId, demoWallet?.expiresAt));
  });

  return app;
}
