import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { DEFAULT_LIMITS } from "@arcie/core";
import { audit, createDb, intents, sessionState, users } from "@arcie/db";
import { createTestDb } from "@arcie/db/testing";
import Database from "better-sqlite3";
import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { expect, it, onTestFinished } from "vitest";
import * as legacy from "../../../packages/db/src/sqlite-schema.js";
import { importSqlite } from "./import-sqlite.js";

const migrationsFolder = fileURLToPath(new URL("../../../packages/db/drizzle-sqlite", import.meta.url));
const workspace = fileURLToPath(new URL("../../..", import.meta.url));
const address = "0x0000000000000000000000000000000000000001";
const email = "sqlite-import@example.invalid";
const timestamp = "2024-02-29T12:34:56.007+00:00";
const firstIntent = "synthetic-intent-rejected";
const statuses = [
  "rejected", "validating", "awaiting_confirmation", "expired", "cancelled", "executing", "succeeded", "failed",
] as const satisfies readonly legacy.IntentStatus[];
const counts = {
  users: 2,
  wallets: 2,
  contacts: 2,
  limits: 2,
  sessions: 1,
  intents: 8,
  choices: 1,
  audit: 3,
  session_state: 2,
  session_events: 0,
  confirm_claims: 0,
  wallet_provisioning: 0,
};

async function fixture(change?: (sqlite: Database.Database) => void) {
  const folder = await mkdtemp(join(tmpdir(), "arcie-sqlite-import-"));
  onTestFinished(() => rm(folder, { recursive: true, force: true }));
  const sqlitePath = join(folder, "fixture.db");
  const sqlite = new Database(sqlitePath);
  try {
    const source = drizzle(sqlite);
    migrate(source, { migrationsFolder });
    sqlite.pragma("foreign_keys = ON");
    const userIds = ["legacy-user-a", "legacy-user-b"];
    source.insert(legacy.users).values(userIds.map((id): typeof legacy.users.$inferInsert => ({
      id, email: id === "legacy-user-a" ? email : null,
      displayName: id, homeChain: "Arc_Testnet", createdAt: timestamp, welcomeDripAt: timestamp,
    }))).run();
    source.insert(legacy.wallets).values(userIds.map((userId): typeof legacy.wallets.$inferInsert => ({
      id: `wallet-${userId}`, userId, chain: "Arc_Testnet", circleWalletId: `circle-${userId}`,
      address, accountType: "SCA",
    }))).run();
    source.insert(legacy.contacts).values(userIds.map((userId): typeof legacy.contacts.$inferInsert => ({
      id: `contact-${userId}`, userId, name: "Fixture", address, chain: "Arc_Testnet",
    }))).run();
    source.insert(legacy.limits).values(userIds.map((userId) => ({ userId, json: DEFAULT_LIMITS }))).run();
    source.insert(legacy.sessions).values({
      id: "voice-session", userId: "legacy-user-a", channel: "voice", userTurn: 3, expiresAt: timestamp,
    }).run();
    source.insert(legacy.intents).values(statuses.map((status): typeof legacy.intents.$inferInsert => ({
      id: `synthetic-intent-${status}`, userId: "legacy-user-a",
      sessionId: status === "failed" ? "screen-session" : "voice-session",
      kind: "send", chain: "Arc_Testnet", status,
      params: { to: address, amount: "1.2300" }, paramsHash: "fixture-params-hash",
      preview: { receipt: { fee: "0.0100", amount: "1.2300" } },
      statusReason: status === "executing" ? "submission_unknown" : null,
      usdValue: "1.2300", createdAt: timestamp, updatedAt: timestamp, expiresAt: timestamp,
    }))).run();
    source.insert(legacy.choices).values({
      id: "legacy-choice", sessionId: "voice-session", question: "Fixture?",
      options: [{ id: "yes", label: "Yes" }], selectedOptionId: "yes", createdAt: timestamp,
    }).run();
    source.insert(legacy.audit).values([1, 2, 3].map((id) => ({
      id, userId: "legacy-user-a", sessionId: "voice-session", intentId: firstIntent,
      type: "fixture", payload: { n: id }, createdAt: timestamp,
    }))).run();
    sqlite.prepare("update audit set payload = ? where id = 1").run('{"exact":9007199254740993}');
    change?.(sqlite);
  } finally {
    sqlite.close();
  }
  return sqlitePath;
}

async function runImport(sqlitePath: string, url?: string, runtimeUrl?: string) {
  return promisify(execFile)("pnpm", ["--silent", "db:import-sqlite", sqlitePath], {
    cwd: workspace,
    env: {
      PATH: [dirname(process.execPath), process.env.PATH].join(delimiter),
      ...(url ? { DATABASE_MIGRATION_URL: url } : {}),
      ...(runtimeUrl ? { DATABASE_URL: runtimeUrl } : {}),
    },
  });
}

it("imports and verifies every table, keeps the backup byte-identical, and restarts audit at max plus one", async () => {
  const target = await createTestDb();
  const sqlitePath = await fixture();
  const original = await readFile(sqlitePath);
  expect(await importSqlite({ sqlitePath, target: target.db })).toEqual({ counts });
  expect(await readFile(sqlitePath)).toEqual(original);

  const [intent] = await target.db.select().from(intents).where(eq(intents.id, firstIntent));
  expect(intent).toBeDefined();
  expect(Buffer.from(JSON.stringify(intent!.params))).toEqual(Buffer.from(`{"to":"${address}","amount":"1.2300"}`));
  expect(Buffer.from(JSON.stringify(intent!.preview?.receipt))).toEqual(Buffer.from('{"fee":"0.0100","amount":"1.2300"}'));
  expect(intent).toMatchObject({ paramsHash: "fixture-params-hash", createdAt: timestamp, usdValue: "1.2300" });
  const storedStatuses = await target.db.select({ status: intents.status, reason: intents.statusReason }).from(intents);
  expect(storedStatuses).toHaveLength(statuses.length);
  expect(storedStatuses).toEqual(expect.arrayContaining(statuses.map((status) => ({
    status, reason: status === "executing" ? "submission_unknown" : null,
  }))));
  expect(await target.db.select().from(sessionState).orderBy(sessionState.sessionId)).toEqual([
    { sessionId: "screen-session", proposalGeneration: 0, preparingGeneration: null, nextEventSeq: 1 },
    { sessionId: "voice-session", proposalGeneration: 0, preparingGeneration: null, nextEventSeq: 1 },
  ]);
  expect(await target.db.execute(sql`select payload->>'exact' as exact from arcie.audit where id = 1`))
    .toEqual([{ exact: "9007199254740993" }]);
  expect(await target.db.insert(audit).values({ userId: "legacy-user-b", type: "after", payload: {} })
    .returning({ id: audit.id })).toEqual([{ id: 4 }]);
});

it("refuses an occupied target without replacing its contents or restarting its identity", async () => {
  const target = await createTestDb();
  const sqlitePath = await fixture();
  await importSqlite({ sqlitePath, target: target.db });
  await target.db.insert(audit).values({ userId: "legacy-user-b", type: "after", payload: {} });
  const original = await target.db.select().from(audit).orderBy(audit.id);

  await expect(importSqlite({ sqlitePath, target: target.db })).rejects.toThrow("TARGET_NOT_EMPTY");
  expect(await target.db.select().from(audit).orderBy(audit.id)).toEqual(original);
  expect(await target.db.insert(audit).values({ userId: "legacy-user-b", type: "second", payload: {} })
    .returning({ id: audit.id })).toEqual([{ id: 5 }]);
});

it("rolls back an orphaned contact without reporting the user or other record values", async () => {
  const target = await createTestDb();
  const sqlitePath = await fixture((sqlite) => {
    sqlite.pragma("foreign_keys = OFF");
    sqlite.prepare("update contacts set user_id = ? where user_id = ?").run("missing-fixture-user", "legacy-user-a");
  });
  await expect(importSqlite({ sqlitePath, target: target.db })).rejects.toThrow(/^SOURCE_USER_REFERENCE_INVALID \(contacts\)$/);
  expect(await importSqlite({ sqlitePath: await fixture(), target: target.db })).toEqual({ counts });
});

it("refuses two legacy pending cards without altering either status or committing any row", async () => {
  const target = await createTestDb();
  const sqlitePath = await fixture((sqlite) => {
    sqlite.prepare("update intents set status = 'awaiting_confirmation' where id = ?").run(firstIntent);
  });
  const original = await readFile(sqlitePath);
  await expect(importSqlite({ sqlitePath, target: target.db })).rejects.toThrow(/^SOURCE_PENDING_INTENT_CONFLICT$/);
  expect(await readFile(sqlitePath)).toEqual(original);
  expect(await importSqlite({ sqlitePath: await fixture(), target: target.db })).toEqual({ counts });
});

it("rejects a missing mapped column even when the source table is empty", async () => {
  const target = await createTestDb();
  const sqlitePath = await fixture((sqlite) => {
    sqlite.exec("delete from choices; alter table choices drop column selected_option_id");
  });
  await expect(importSqlite({ sqlitePath, target: target.db })).rejects.toThrow(/^SOURCE_SCHEMA_MISMATCH \(choices\)$/);
  expect(await importSqlite({ sqlitePath: await fixture(), target: target.db })).toEqual({ counts });
});

it("serializes competing imports into the same empty target", async () => {
  const target = await createTestDb();
  const sqlitePath = await fixture();
  const results = await Promise.allSettled([
    importSqlite({ sqlitePath, target: target.db }),
    importSqlite({ sqlitePath, target: target.db }),
  ]);
  expect(results).toEqual(expect.arrayContaining([
    { status: "fulfilled", value: { counts } },
    { status: "rejected", reason: expect.objectContaining({ message: "TARGET_NOT_EMPTY" }) },
  ]));
});

it("waits for an in-progress writer in a Postgres-only table and refuses its committed row", async () => {
  const target = await createTestDb();
  const sqlitePath = await fixture();
  let releaseWriter!: () => void;
  const writerCanCommit = new Promise<void>((resolve) => { releaseWriter = resolve; });
  let notifyInserted!: () => void;
  const inserted = new Promise<void>((resolve) => { notifyInserted = resolve; });
  const writer = target.db.transaction(async (tx) => {
    await tx.insert(sessionState).values({ sessionId: "in-progress-writer" });
    notifyInserted();
    await writerCanCommit;
  });
  await inserted;
  const importing = expect(importSqlite({ sqlitePath, target: target.db })).rejects.toThrow("TARGET_NOT_EMPTY");
  try {
    await expect.poll(async () => {
      const [row] = await target.db.execute<{ waiting: boolean }>(sql`
        select exists (
          select 1 from pg_locks
          where relation = 'arcie.session_state'::regclass and not granted
        ) as waiting
      `);
      return row?.waiting;
    }).toBe(true);
  } finally {
    releaseWriter();
    await writer;
    await importing;
  }
  expect(await target.db.select({ id: sessionState.sessionId }).from(sessionState))
    .toEqual([{ id: "in-progress-writer" }]);
});

it("refuses a target if an additional application table contains rows", async () => {
  const target = await createTestDb();
  const sqlitePath = await fixture();
  // Quoted relation names must be handled safely even when they fall outside the mapped schema.
  await target.db.execute(sql`create table arcie."new""ledger" (value text)`);
  await target.db.execute(sql`insert into arcie."new""ledger" values ('synthetic')`);

  await expect(importSqlite({ sqlitePath, target: target.db })).rejects.toThrow(/^TARGET_NOT_EMPTY$/);
  expect(await target.db.select().from(users)).toEqual([]);
  expect(await target.db.execute(sql`select value from arcie."new""ledger"`)).toEqual([{ value: "synthetic" }]);
});

it("refuses an unexpected empty table instead of assuming the target schema is compatible", async () => {
  const target = await createTestDb();
  const sqlitePath = await fixture();
  await target.db.execute(sql`create table arcie.future_ledger (value text)`);

  await expect(importSqlite({ sqlitePath, target: target.db })).rejects.toThrow(/^TARGET_SCHEMA_MISMATCH$/);
  expect(await target.db.select().from(users)).toEqual([]);
});

it("refuses foreign tables before opening the backup or contacting the foreign server", async () => {
  const target = await createTestDb();
  await target.db.execute(sql`create extension postgres_fdw`);
  await target.db.execute(sql`
    create server import_fixture_foreign_server foreign data wrapper postgres_fdw
    options (host '127.0.0.1', port '1', dbname 'fixture')
  `);
  await target.db.execute(sql`
    create foreign table arcie.foreign_ledger (value text) server import_fixture_foreign_server
  `);

  const folder = await mkdtemp(join(tmpdir(), "arcie-sqlite-import-"));
  onTestFinished(() => rm(folder, { recursive: true, force: true }));
  const sqlitePath = join(folder, "missing-fixture.db");
  await expect(importSqlite({ sqlitePath, target: target.db })).rejects.toThrow(/^TARGET_SCHEMA_MISMATCH$/);
  expect(await target.db.select().from(users)).toEqual([]);
});

it("advertises the quiet root invocation in the CLI usage message", async () => {
  await expect(runImport("")).rejects.toMatchObject({
    stdout: "",
    stderr: "Usage: pnpm --silent db:import-sqlite <backup.db>\n",
  });
}, 15_000);

it("prints only table counts from the workspace CLI", async () => {
  const target = await createTestDb();
  const { stdout, stderr } = await runImport(relative(workspace, await fixture()), target.url);
  expect(stderr).toBe("");
  expect(stdout.trimEnd().split("\n").sort()).toEqual(
    Object.entries(counts).map(([name, count]) => `${name} ${count}`).sort(),
  );
  for (const value of [address, email, firstIntent]) expect(stdout).not.toContain(value);
}, 15_000);

it("prints only a fixed diagnostic for a CLI failure caused by a source record", async () => {
  const target = await createTestDb();
  const sqlitePath = await fixture((sqlite) => {
    sqlite.prepare("update intents set status = 'awaiting_confirmation' where id = ?").run(firstIntent);
  });
  await expect(runImport(sqlitePath, target.url)).rejects.toMatchObject({
    stdout: "",
    stderr: "SOURCE_PENDING_INTENT_CONFLICT\n",
  });
}, 15_000);

it.each([
  {
    scenario: "missing migration URL",
    migrationUrl: undefined,
    diagnostic: "Set DATABASE_MIGRATION_URL to a dedicated Postgres connection.",
  },
  {
    scenario: "transaction pooler",
    migrationUrl: "postgres://fixture:synthetic@127.0.0.1:6543/fixture",
    diagnostic: "DATABASE_MIGRATION_URL must use a direct or session-mode connection.",
  },
])("requires the dedicated process-injected connection ($scenario)", async ({ migrationUrl, diagnostic }) => {
  const target = await createTestDb();
  await expect(runImport(await fixture(), migrationUrl, target.url)).rejects.toMatchObject({
    stdout: "",
    stderr: `${diagnostic}\n`,
  });
}, 15_000);

it("refuses a restricted runtime role even when its target is empty", async () => {
  const target = await createTestDb();
  const runtimeUrl = new URL(target.url);
  runtimeUrl.searchParams.set("options", "-c role=arcie_runtime");
  const runtime = createDb(runtimeUrl.toString());
  onTestFinished(runtime.close);
  const [identity] = await runtime.db.execute<{ role: string }>(sql`select current_user as role`);
  expect(identity?.role).toBe("arcie_runtime");

  const sqlitePath = await fixture();
  await expect(importSqlite({ sqlitePath, target: runtime.db })).rejects.toThrow(/^TARGET_OWNER_REQUIRED$/);
  expect(await importSqlite({ sqlitePath, target: target.db })).toEqual({ counts });
});

it.each([".env", "recovery/fixture.db"])("refuses reserved backup paths before opening them (%s)", async (file) => {
  const target = await createTestDb();
  const sqlitePath = join(tmpdir(), "arcie-reserved-test-path", file);
  await expect(importSqlite({ sqlitePath, target: target.db })).rejects.toThrow(/^SOURCE_PATH_FORBIDDEN$/);
});
