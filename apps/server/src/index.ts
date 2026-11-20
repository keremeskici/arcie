import { Hono } from "hono";
import { databaseEndpoint } from "@arcie/db";
import { loadEnv } from "./env.js";
import type { createRuntime } from "./runtime.js";

async function startRuntime() {
  const env = loadEnv();
  if (env.AUTH_MODE !== "privy" || !env.LLM_SHARED_SECRET) {
    throw new Error("Vercel requires AUTH_MODE=privy and LLM_SHARED_SECRET.");
  }
  const { loopback, port } = databaseEndpoint(env.DATABASE_URL);
  if (!loopback && (port !== 6543 || env.DATABASE_SSL !== "require")) {
    throw new Error("Vercel requires the transaction pooler on port 6543 with verified TLS.");
  }
  const { createRuntime } = await import("./runtime.js");
  return createRuntime(env);
}

let runtime: ReturnType<typeof createRuntime> | undefined;
const app = new Hono();
app.all("*", async (c) => {
  runtime ??= startRuntime().catch((error) => {
    runtime = undefined;
    console.error("Arcie runtime initialization failed");
    throw error;
  });
  let initialized;
  try {
    initialized = await runtime;
  } catch {
    return c.json({ error: { code: "UNKNOWN", message: "Service temporarily unavailable." } }, 503);
  }
  return initialized.app.fetch(c.req.raw, c.env);
});

export default app;
