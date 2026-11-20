import { databaseEndpoint } from "@arcie/db";
import { z } from "zod";

const optional = z.preprocess((v) => (v === "" ? undefined : v), z.string().optional());

const schema = z.object({
  CIRCLE_API_KEY: z.string().min(1),
  CIRCLE_ENTITY_SECRET: z.string().min(1),
  ONRAMP_API_KEY: z.string().min(1),
  ONRAMP_ENVIRONMENT: z.enum(["sandbox", "production"]).default("sandbox"),
  OPENAI_API_KEY: z.string().min(1),
  OPENAI_MODEL: z.string().min(1),
  OPENAI_REASONING_EFFORT: optional,
  APPKIT_API_KEY: optional,
  ARC_RPC_URL: optional,
  ONRAMP_REFERRER_DOMAIN: optional,
  DATABASE_URL: z.string().refine((value) => {
    try {
      databaseEndpoint(value);
      return true;
    } catch {
      return false;
    }
  }),
  DATABASE_POOL_MAX: z.coerce.number().int().positive().default(3),
  DATABASE_SSL: z.preprocess((v) => v === "" ? undefined : v, z.enum(["require", "disable"]).optional()),
  DATABASE_SSL_CA: optional,
  PORT: z.coerce.number().int().default(8787),
  DEMO_USER_ID: z.string().default("demo"),
  DEMO_WALLET_SESSION_SECRET: z.preprocess((v) => v === "" ? undefined : v, z.string().min(32).optional()),
  CONFIRM_CHANNELS: z.enum(["any", "screen"]).default("any"),
  AUTH_MODE: z.enum(["dev", "privy"]).default("dev"),
  PRIVY_APP_ID: optional,
  PRIVY_APP_SECRET: optional,
  PRIVY_JWT_VERIFICATION_KEY: optional,
  CIRCLE_WALLET_SET_ID: optional,
  ADMIN_PRIVATE_KEY: optional,
  WELCOME_DRIP_USDC: optional,
  LLM_SHARED_SECRET: optional,
  ELEVENLABS_AGENT_ID: optional,
}).superRefine((e, ctx) => {
  if ((e.ONRAMP_ENVIRONMENT === "sandbox" && e.ONRAMP_API_KEY.startsWith("LIVE_API_KEY:")) ||
      (e.ONRAMP_ENVIRONMENT === "production" && e.ONRAMP_API_KEY.startsWith("TEST_API_KEY:"))) {
    ctx.addIssue({ code: "custom", path: ["ONRAMP_API_KEY"], message: "must match ONRAMP_ENVIRONMENT" });
  }
  if (e.AUTH_MODE !== "privy") return;
  for (const k of ["PRIVY_APP_ID", "PRIVY_APP_SECRET", "CIRCLE_WALLET_SET_ID"] as const) {
    if (!e[k]) ctx.addIssue({ code: "custom", path: [k], message: "required when AUTH_MODE=privy" });
  }
}).transform((e) => ({
  ...e,
  DATABASE_SSL: e.DATABASE_SSL ?? (databaseEndpoint(e.DATABASE_URL).loopback ? "disable" as const : "require" as const),
}));

export type Env = z.infer<typeof schema>;

/** Validates the environment once at startup and names every missing key. */
export function loadEnv(source: Record<string, string | undefined> = process.env): Env {
  const r = schema.safeParse(source);
  if (r.success) return r.data;
  const keys = r.error.issues.map((i) => i.path.join("."));
  throw new Error(`Missing or invalid environment variables: ${keys.join(", ")}. See .env.example.`);
}
