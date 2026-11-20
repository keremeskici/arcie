import type { AppKitPort } from "@arcie/appkit";
import type { Db } from "@arcie/db";
import type { EventLog, Harness } from "@arcie/harness";
import { sql } from "drizzle-orm";
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
import type { createDemoWalletAuth } from "./auth/demo-wallet.js";
import { resolveVoiceSession, type AuthMode } from "./auth/identify.js";
import type { onboard } from "./auth/onboard.js";
import type { Identity } from "./auth/verifier.js";
import { chatRoutes, type AgentFn } from "./llm/route.js";

export interface AppDeps {
  harness: Harness;
  db: Db;
  kit: AppKitPort;
  events: EventLog;
  /** Stream tuning; tests shorten these. Defaults: 240 s per stream, 1 s poll, 15 s ping. */
  sse?: { maxMs?: number; pollMs?: number; pingMs?: number };
  agent: AgentFn;
  demoUserId: string;
  model: string;
  /** Resolve the request identity or throw AuthError → 401. */
  identify: (c: Context) => Promise<Identity>;
  authMode: AuthMode;
  demoWalletAuth?: ReturnType<typeof createDemoWalletAuth> | undefined;
  /** Optional shared secret ElevenLabs must send as `Authorization: Bearer …` on the custom-LLM endpoint. */
  llmSecret?: string | undefined;
  /** Public client config for the UI. */
  privyAppId?: string | undefined;
  elevenLabsAgentId?: string | undefined;
  /** First-login setup: user row, limits, Circle wallet, welcome drip. */
  onboard: (id: Identity) => ReturnType<typeof onboard>;
}

/** Composes every route; tests build it with fakes, runtime.ts with the real Circle kit and OpenAI. */
export function createApp(deps: AppDeps): Hono {
  const app = new Hono();
  app.use("*", cors());
  app.onError((e, c) => errorResponse(c, e));
  app.get("/health", async (c) => {
    try {
      await deps.db.execute(sql`select 1`);
      return c.json({ ok: true });
    } catch {
      return c.json({ error: { code: "UNKNOWN", message: "Service temporarily unavailable." } }, 503);
    }
  });
  app.route("/", uiRoutes());
  app.route("/", chatRoutes({ ...deps, authMode: deps.authMode, llmSecret: deps.llmSecret }));
  app.route("/", meRoutes(deps));
  app.route("/", intentRoutes(deps));
  app.route("/", contactRoutes(deps));
  app.route("/", onrampRoutes(deps));
  app.route("/", authRoutes(deps));
  app.route("/", eventRoutes({
    ...deps,
    ...(deps.authMode === "privy" ? { authorizeSession: async (sid: string) => (await resolveVoiceSession(deps.db, sid)) !== null } : {}),
  }));
  return app;
}
