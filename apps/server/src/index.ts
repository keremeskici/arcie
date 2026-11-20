import { createCircleAppKit, getWallet, HOME_CHAIN } from "@arcie/appkit";
import { createDb, seed } from "@arcie/db";
import { createHarness, DbPolicyProvider, EventLog } from "@arcie/harness";
import { initiateDeveloperControlledWalletsClient } from "@circle-fin/developer-controlled-wallets";
import { serve } from "@hono/node-server";
import OpenAI from "openai";
import { createApp } from "./app.js";
import { createAdminDrip } from "./auth/drip.js";
import { createIdentify } from "./auth/identify.js";
import { onboard } from "./auth/onboard.js";
import { createPrivyVerifier } from "./auth/verifier.js";
import { loadEnv } from "./env.js";
import { runAgentTurn, type ChatClient } from "./llm/loop.js";
import { reconcileExecuting } from "./reconcile.js";

const env = loadEnv();
const { db } = createDb(env.DATABASE_URL);
await seed(db, { userId: env.DEMO_USER_ID });

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

const app = createApp({
  harness,
  db,
  kit,
  events,
  authMode: env.AUTH_MODE,
  llmSecret: env.LLM_SHARED_SECRET,
  privyAppId: env.PRIVY_APP_ID,
  elevenLabsAgentId: env.ELEVENLABS_AGENT_ID,
  identify: createIdentify({ mode: env.AUTH_MODE, verifier, demoUserId: env.DEMO_USER_ID }),
  onboard: (id) => {
    if (!env.CIRCLE_WALLET_SET_ID) throw new Error("CIRCLE_WALLET_SET_ID is missing; run `pnpm provision` first.");
    return onboard({ db, circle, walletSetId: env.CIRCLE_WALLET_SET_ID, drip: drip ? (address) => drip(address) : undefined }, id);
  },
  demoUserId: env.DEMO_USER_ID,
  model: env.OPENAI_MODEL,
  agent: (ctx, messages, signal) => runAgentTurn(agentDeps, ctx, messages, signal),
});

const reconciled = await reconcileExecuting({ db, kit, events });
if (reconciled) console.log(`Reconciled ${reconciled} in-flight intent(s) from before the restart.`);

if (!(await getWallet(db, env.DEMO_USER_ID, HOME_CHAIN))) {
  console.warn(`No wallet for "${env.DEMO_USER_ID}" yet. Run \`pnpm provision\` first.`);
}

serve({ fetch: app.fetch, port: env.PORT }, (info) => {
  console.log(`Arcie server on http://localhost:${info.port} (model ${env.OPENAI_MODEL}, auth ${env.AUTH_MODE})`);
});
