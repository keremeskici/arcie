/**
 * One Postgres server per test run, shared by every vitest project.
 *
 * - `TEST_DATABASE_URL` set: use that server (admin URL, any database on it) and don't start one.
 * - Otherwise: start `embedded-postgres` on a free port with its data dir under `.superpowers/pg-test/`.
 *
 * Either way we (re)build a migrated `arcie_template` database; tests clone it per file via `createTestDb()`.
 * Each project runs this setup, so server start/stop is reference-counted in the main process.
 */
import EmbeddedPostgres from "embedded-postgres";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import type { TestProject } from "vitest/node";
import { migrateDb } from "./packages/db/src/migrate.js";
import { TEMPLATE_DB, withDatabase } from "./packages/db/src/testing-shared.js";

const BASE_DIR = fileURLToPath(new URL("./.superpowers/pg-test", import.meta.url));

interface Booted {
  url: string;
  stop: () => Promise<void>;
}
interface Shared {
  refs: number;
  booting: Promise<Booted>;
}
const g = globalThis as typeof globalThis & { __arciePg?: Shared };

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.once("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address() as { port: number };
      srv.close(() => resolve(port));
    });
  });
}

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
};

/** Each run owns a fresh directory. Only dirs whose owning run is gone are swept; nothing is ever killed. */
async function sweepDeadRuns(): Promise<void> {
  for (const name of await readdir(BASE_DIR).catch(() => [])) {
    if (!name.startsWith("run-")) continue;
    const dir = join(BASE_DIR, name);
    const owner = Number(await readFile(join(dir, "owner.pid"), "utf8").catch(() => "0"));
    if (owner > 0 && !alive(owner)) await rm(dir, { recursive: true, force: true });
  }
}

async function boot(): Promise<Booted> {
  let serverUrl: string;
  let stopServer = async () => {};

  if (process.env.TEST_DATABASE_URL) {
    serverUrl = process.env.TEST_DATABASE_URL;
  } else {
    await mkdir(BASE_DIR, { recursive: true });
    await sweepDeadRuns();
    const runDir = await mkdtemp(join(BASE_DIR, "run-"));
    await writeFile(join(runDir, "owner.pid"), String(process.pid));
    const dataDir = join(runDir, "data");
    const port = await freePort();
    const pg = new EmbeddedPostgres({
      databaseDir: dataDir,
      port,
      user: "postgres",
      password: "password",
      persistent: false,
      onLog: () => {},
      onError: () => {},
    });
    await pg.initialise();
    await pg.start();
    stopServer = async () => {
      await pg.stop();
      await rm(runDir, { recursive: true, force: true });
    };
    serverUrl = `postgres://postgres:password@127.0.0.1:${port}/postgres`;
  }

  try {
    const admin = postgres(serverUrl, { max: 1, prepare: false, onnotice: () => {} });
    try {
      await admin.unsafe(`DROP DATABASE IF EXISTS ${TEMPLATE_DB} WITH (FORCE)`);
      await admin.unsafe(`CREATE DATABASE ${TEMPLATE_DB}`);
    } finally {
      await admin.end({ timeout: 5 });
    }
    await migrateDb(withDatabase(serverUrl, TEMPLATE_DB));
  } catch (err) {
    await stopServer();
    throw err;
  }
  return { url: serverUrl, stop: stopServer };
}

export default async function setup(project: TestProject) {
  const shared = (g.__arciePg ??= { refs: 0, booting: boot() });
  shared.refs++;
  const { url } = await shared.booting;
  project.provide("arcieTestServerUrl", url);

  return async () => {
    shared.refs--;
    if (shared.refs === 0) {
      g.__arciePg = undefined;
      await (await shared.booting).stop();
    }
  };
}
