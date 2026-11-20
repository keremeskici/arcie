import type { AppKitPort } from "@arcie/appkit";
import type { TokenSymbol } from "@arcie/core";
import type { Db } from "@arcie/db";
import type { EventBus, Harness } from "@arcie/harness";
import { Hono, type Context } from "hono";
import { cors } from "hono/cors";
import { authRoutes } from "./api/auth.js";
import { contactRoutes } from "./api/contacts.js";
import { errorResponse } from "./api/http.js";
import { intentRoutes } from "./api/intents.js";
import { meRoutes } from "./api/me.js";
import { onrampRoutes } from "./api/onramp.js";
import { uiRoutes } from "./api/ui.js";
import { eventRoutes } from "./events/sse.js";
import { resolveVoiceSession, type AuthMode } from "./auth/identify.js";
import type { onboard } from "./auth/onboard.js";
import type { Identity } from "./auth/verifier.js";
import { chatRoutes, type AgentFn } from "./llm/route.js";

export interface AppDeps {
  harness: Harness;
  db: Db;
  kit: AppKitPort;
  bus: EventBus;
  agent: AgentFn;
  demoUserId: string;
  model: string;
  /** Who is calling (spec §17): dev header/demo user, or a verified Privy bearer token. Throws AuthError → 401. */
  identify: (c: Context) => Promise<Identity>;
  authMode: AuthMode;
  /** Optional shared secret ElevenLabs must send as `Authorization: Bearer …` on the custom-LLM endpoint. */
  llmSecret?: string | undefined;
  /** Public client config for the UI. */
  privyAppId?: string | undefined;
  elevenLabsAgentId?: string | undefined;
  /** Display-only USD prices (CoinGecko Demo, cached) for /balances. Absent: App Kit rates only. */
  tokenUsdPrice?: ((token: TokenSymbol) => Promise<number | null>) | undefined;
  /** First-login setup: user row, limits, Circle wallet, welcome drip. */
  onboard: (id: Identity) => ReturnType<typeof onboard>;
}

/** Composes every route; tests build it with fakes, index.ts with the real Circle kit + OpenAI. */
export function createApp(deps: AppDeps): Hono {
  const app = new Hono();
  app.use("*", cors());
  app.onError((e, c) => errorResponse(c, e));
  app.get("/health", (c) => c.json({ ok: true }));
  app.route("/", uiRoutes());
  app.route("/", chatRoutes({ ...deps, authMode: deps.authMode, llmSecret: deps.llmSecret }));
  app.route("/", meRoutes(deps));
  app.route("/", intentRoutes(deps));
  app.route("/", contactRoutes(deps));
  app.route("/", onrampRoutes(deps));
  app.route("/", authRoutes(deps));
  app.route("/", eventRoutes({
    ...deps,
    ...(deps.authMode === "privy" ? { authorizeSession: async (sid: string) => resolveVoiceSession(deps.db, sid) !== null } : {}),
  }));
  return app;
}
