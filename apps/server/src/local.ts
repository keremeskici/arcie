import { getWallet, HOME_CHAIN } from "@arcie/appkit";
import { createDb, seed } from "@arcie/db";
import { serve } from "@hono/node-server";
import { loadEnv } from "./env.js";
import { createRuntime } from "./runtime.js";

const env = loadEnv();

if (env.AUTH_MODE === "dev") {
  const { db, close } = createDb(env.DATABASE_URL, {
    max: 1,
    ssl: env.DATABASE_SSL === "disable" ? false : "require",
    sslCa: env.DATABASE_SSL_CA,
  });
  try {
    await seed(db, { userId: env.DEMO_USER_ID });
    if (!(await getWallet(db, env.DEMO_USER_ID, HOME_CHAIN))) {
      console.warn(`No wallet for "${env.DEMO_USER_ID}" yet. Run \`pnpm provision\` first.`);
    }
  } finally {
    await close();
  }
}

const runtime = await createRuntime(env);
const server = serve({ fetch: runtime.app.fetch, port: env.PORT }, (info) => {
  console.log(`Arcie server on http://localhost:${info.port} (model ${env.OPENAI_MODEL}, auth ${env.AUTH_MODE})`);
});

let stopping = false;
function shutdown() {
  if (stopping) return;
  stopping = true;
  server.close((error) => {
    void runtime.close().catch((error: unknown) => {
      console.error("Failed to close the database pool", error);
      process.exitCode = 1;
    });
    if (error && (error as NodeJS.ErrnoException).code !== "ERR_SERVER_NOT_RUNNING") {
      console.error("Failed to close the local listener", error);
      process.exitCode = 1;
    }
  });
}

server.once("error", (error) => {
  console.error("Local listener failed", error);
  process.exitCode = 1;
  shutdown();
});
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
