import { createCircleAppKit } from "@arcie/appkit";
import { createDb } from "@arcie/db";
import { createHarness, DbPolicyProvider, EventLog } from "@arcie/harness";
import { sql } from "drizzle-orm";
import type { Hono } from "hono";
import { createRequire } from "node:module";
import OpenAI from "openai";
import { createApp } from "./create-app.js";
import { createAdminDrip } from "./auth/drip.js";
import { createDemoWalletAuth } from "./auth/demo-wallet.js";
import { createIdentify } from "./auth/identify.js";
import { onboard } from "./auth/onboard.js";
import { createPrivyVerifier } from "./auth/verifier.js";
import type { Env } from "./env.js";
import { runAgentTurn, type ChatClient } from "./llm/loop.js";

// Use the Wallets SDK's CommonJS export on Node runtimes that disable ESM syntax detection.
const require = createRequire(import.meta.url);
const { initiateDeveloperControlledWalletsClient } = require("@circle-fin/developer-controlled-wallets") as
  typeof import("@circle-fin/developer-controlled-wallets");

/** Creates a request runtime and verifies database connectivity before returning it. */
export async function createRuntime(env: Env): Promise<{ app: Hono; close(): Promise<void> }> {
  const { db, close } = createDb(env.DATABASE_URL, {
    max: env.DATABASE_POOL_MAX,
    ssl: env.DATABASE_SSL === "disable" ? false : "require",
    sslCa: env.DATABASE_SSL_CA,
  });
  try {
    await db.execute(sql`select 1`);

    const kit = createCircleAppKit({
      circleApiKey: env.CIRCLE_API_KEY,
      entitySecret: env.CIRCLE_ENTITY_SECRET,
      onrampApiKey: env.ONRAMP_API_KEY,
      onrampEnvironment: env.ONRAMP_ENVIRONMENT,
      ...(env.APPKIT_API_KEY ? { appKitApiKey: env.APPKIT_API_KEY } : {}),
      ...(env.ONRAMP_REFERRER_DOMAIN ? { referrerDomain: env.ONRAMP_REFERRER_DOMAIN } : {}),
      ...(env.ARC_RPC_URL ? { rpcUrls: { Arc_Testnet: env.ARC_RPC_URL } } : {}),
    });
    const events = new EventLog(db);
    const harness = createHarness({ db, kit, policy: new DbPolicyProvider(db), events, confirmChannels: env.CONFIRM_CHANNELS });
    const openai = new OpenAI({ apiKey: env.OPENAI_API_KEY }) as unknown as ChatClient;
    const agentDeps = { openai, model: env.OPENAI_MODEL, reasoningEffort: env.OPENAI_REASONING_EFFORT, harness };

    const circle = initiateDeveloperControlledWalletsClient({ apiKey: env.CIRCLE_API_KEY, entitySecret: env.CIRCLE_ENTITY_SECRET });
    const verifier =
      env.PRIVY_APP_ID && env.PRIVY_APP_SECRET
        ? createPrivyVerifier({ appId: env.PRIVY_APP_ID, appSecret: env.PRIVY_APP_SECRET, jwtVerificationKey: env.PRIVY_JWT_VERIFICATION_KEY })
        : undefined;
    const drip =
      env.WELCOME_DRIP_USDC && env.ADMIN_PRIVATE_KEY
        ? createAdminDrip({ adminKey: env.ADMIN_PRIVATE_KEY as `0x${string}`, rpcUrl: env.ARC_RPC_URL, amountUsdc: env.WELCOME_DRIP_USDC })
        : undefined;

    const demoWalletAuth = env.AUTH_MODE === "privy" && env.ONRAMP_ENVIRONMENT === "sandbox" &&
      !env.DEMO_USER_ID.startsWith("did:") && env.DEMO_WALLET_SESSION_SECRET
        ? createDemoWalletAuth(env.DEMO_WALLET_SESSION_SECRET, env.DEMO_USER_ID)
        : undefined;
    const app = createApp({
      harness,
      db,
      kit,
      events,
      authMode: env.AUTH_MODE,
      llmSecret: env.LLM_SHARED_SECRET,
      privyAppId: env.PRIVY_APP_ID,
      elevenLabsAgentId: env.ELEVENLABS_AGENT_ID,
      demoWalletAuth,
      identify: createIdentify({ mode: env.AUTH_MODE, verifier, demoUserId: env.DEMO_USER_ID, demoWalletAuth }),
      onboard: (id) => {
        if (!env.CIRCLE_WALLET_SET_ID) throw new Error("CIRCLE_WALLET_SET_ID is missing; run `pnpm provision` first.");
        return onboard({ db, circle, walletSetId: env.CIRCLE_WALLET_SET_ID, drip: drip ? (address, submitted) => drip(address, undefined, submitted) : undefined }, id);
      },
      demoUserId: env.DEMO_USER_ID,
      model: env.OPENAI_MODEL,
      agent: (ctx, messages, signal) => runAgentTurn(agentDeps, ctx, messages, signal),
    });
    return { app, close };
  } catch (error) {
    await close();
    throw error;
  }
}
