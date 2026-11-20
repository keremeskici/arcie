import { createDb } from "@arcie/db";
import { createTestDb, withDatabase } from "@arcie/db/testing";
import { sql } from "drizzle-orm";
import { build } from "esbuild";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import net from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, inject, it, onTestFinished, vi } from "vitest";
import { uiRoutes } from "./api/ui.js";
import { loadEnv } from "./env.js";

vi.mock("@arcie/db", { spy: true });
vi.mock("esbuild", { spy: true });

const hostedEnv = {
  CIRCLE_API_KEY: "TEST_API_KEY:fixture:fixture",
  CIRCLE_ENTITY_SECRET: "e".repeat(64),
  CIRCLE_WALLET_SET_ID: "fixture-wallet-set",
  ONRAMP_API_KEY: "TEST_API_KEY:fixture:fixture",
  ONRAMP_ENVIRONMENT: "sandbox",
  OPENAI_API_KEY: "sk-fixture",
  OPENAI_MODEL: "test-model",
  AUTH_MODE: "privy",
  PRIVY_APP_ID: "fixture-app",
  PRIVY_APP_SECRET: "fixture-secret",
  LLM_SHARED_SECRET: "fixture-llm-secret",
};

function stubHostedEnv(databaseUrl: string) {
  for (const [key, value] of Object.entries({ ...hostedEnv, DATABASE_URL: databaseUrl })) {
    vi.stubEnv(key, value);
  }
}

afterEach(async () => {
  for (const result of vi.mocked(createDb).mock.results) {
    if (result.type === "return") await result.value.close();
  }
  vi.clearAllMocks();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

it("imports the Vercel entry without checking configuration or opening a socket", async () => {
  vi.resetModules();
  stubHostedEnv("postgres://fixture:fixture@127.0.0.1:1/postgres");
  vi.stubEnv("OPENAI_API_KEY", undefined);
  const connect = vi.spyOn(net, "connect");
  const app = (await import("./index.js")).default;
  expect(connect).not.toHaveBeenCalled();

  vi.stubEnv("OPENAI_API_KEY", hostedEnv.OPENAI_API_KEY);
  const response = await app.request("/health");
  expect([500, 503]).toContain(response.status);
  expect(connect).toHaveBeenCalled();
});

it("retries failed initialization and shares a healthy runtime across requests", async () => {
  vi.resetModules();
  const { url } = await createTestDb();
  stubHostedEnv("postgres://fixture:fixture@127.0.0.1:1/postgres");
  const app = (await import("./index.js")).default;
  expect([500, 503]).toContain((await app.request("/health")).status);

  vi.stubEnv("DATABASE_URL", url);
  const responses = await Promise.all([app.request("/health"), app.request("/health")]);
  for (const response of responses) {
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
  }
  expect(vi.mocked(createDb).mock.calls.map(([url]) => new URL(url).port)).toEqual(["1", new URL(url).port]);
});

it.each([
  ["without Privy", { AUTH_MODE: "dev" }],
  ["without an ElevenLabs shared secret", { LLM_SHARED_SECRET: "" }],
])("rejects the Vercel runtime %s", async (_name, envOverride) => {
  vi.resetModules();
  stubHostedEnv(inject("arcieTestServerUrl"));
  for (const [key, value] of Object.entries(envOverride)) vi.stubEnv(key, value);
  const app = (await import("./index.js")).default;
  const response = await app.request("/health");
  expect(response.status).toBe(503);
  expect(createDb).not.toHaveBeenCalled();
});

it("checks connectivity on an empty database without creating the application schema", async () => {
  const url = withDatabase(inject("arcieTestServerUrl"), "postgres");
  const { createRuntime } = await import("./runtime.js");
  const runtime = await createRuntime(loadEnv({ ...hostedEnv, DATABASE_URL: url }));
  onTestFinished(runtime.close);

  const response = await runtime.app.request("/health");
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ ok: true });

  const { db, close } = createDb(url);
  onTestFinished(close);
  const [row] = await db.execute<{ table_name: string | null }>(sql`select to_regclass('arcie.users') as table_name`);
  expect(row?.table_name).toBeNull();
});

it("serves the prebuilt checkout script without bundling again on request", async () => {
  const assetDir = await mkdtemp(join(tmpdir(), "arcie-onramp-"));
  onTestFinished(() => rm(assetDir, { recursive: true, force: true }));
  const { buildAssets } = await import("../scripts/build-assets.js");
  await buildAssets(assetDir);
  vi.mocked(build).mockClear();

  const response = await uiRoutes(assetDir).request("/assets/onramp.js");
  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toContain("text/javascript");
  expect(await response.text()).toBe(await readFile(join(assetDir, "onramp.js"), "utf8"));
  expect(build).not.toHaveBeenCalled();
});

it("starts the local listener and releases its Postgres connection on SIGTERM", async () => {
  const { spawn } = await import("node:child_process");
  const { once } = await import("node:events");
  const { db, url } = await createTestDb();
  const child = spawn(process.execPath, ["--import", "tsx", "src/local.ts"], {
    cwd: new URL("../", import.meta.url),
    env: { ...process.env, ...hostedEnv, DATABASE_URL: url, PORT: "0" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const exited = once(child, "exit");
  onTestFinished(async () => {
    child.kill("SIGKILL");
    await exited;
  });
  let output = "";
  child.stderr.setEncoding("utf8").on("data", (chunk: string) => { output += chunk; });
  const listening = (async () => {
    for await (const chunk of child.stdout) {
      output += String(chunk);
      const match = output.match(/Arcie server on http:\/\/localhost:(\d+)/);
      if (match) return Number(match[1]);
    }
    throw new Error(`Local HTTP server did not start. ${output}`);
  })();
  const port = await listening;
  expect(await (await fetch(`http://localhost:${port}/health`)).json()).toEqual({ ok: true });
  const [before] = await db.execute<{ clients: number }>(sql`
    select count(*)::int as clients from pg_stat_activity
    where datname = current_database() and pid <> pg_backend_pid()
  `);
  expect(before?.clients).toBeGreaterThan(0);

  child.kill("SIGTERM");
  await expect(exited).resolves.toEqual([0, null]);
  const [after] = await db.execute<{ clients: number }>(sql`
    select count(*)::int as clients from pg_stat_activity
    where datname = current_database() and pid <> pg_backend_pid()
  `);
  expect(after?.clients).toBe(0);
}, 10_000);


it("initializes the Vercel entry with Node's ESM syntax detection disabled", async () => {
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const { url } = await createTestDb();
  const script = `
    const { default: app } = await import('./src/index.ts');
    const health = await app.request('/health');
    const protectedRoute = await app.request('/me');
    process.stdout.write(JSON.stringify([health.status, await health.json(), protectedRoute.status]));
    process.exit(0);
  `;
  const { stdout } = await promisify(execFile)(process.execPath, [
    "--no-experimental-detect-module", "--import", "tsx", "--input-type=module", "--eval", script,
  ], { cwd: new URL("../", import.meta.url), env: { ...process.env, ...hostedEnv, DATABASE_URL: url }, timeout: 10_000 });
  expect(JSON.parse(stdout)).toEqual([200, { ok: true }, 401]);
});
