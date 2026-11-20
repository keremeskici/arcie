import { sql } from "drizzle-orm";
import { readFile } from "node:fs/promises";
import postgres from "postgres";
import { expect, it, onTestFinished, vi } from "vitest";
import { createDb } from "./client.js";
import { migrateDb } from "./migrate.js";
import { createTestDb } from "./testing.js";

vi.mock("postgres", { spy: true });

it("serializes pooler traffic with verified TLS and disables prepared statements", () => {
  const url = "postgres://app.ref:fixture@pooler.example.invalid:6543/postgres?sslmode=require";
  const client = createDb(url);
  onTestFinished(client.close);
  expect(postgres).toHaveBeenCalledWith(url, expect.objectContaining({
    max: 3,
    max_pipeline: 1,
    prepare: false,
    ssl: { rejectUnauthorized: true },
  }));
});

it("uses the supplied CA for verified TLS and keeps loopback usable without TLS", () => {
  const ca = "fixture-certificate";
  const remote = createDb("postgres://example.invalid/db", { ssl: "require", sslCa: ca });
  onTestFinished(remote.close);
  expect(postgres).toHaveBeenLastCalledWith(expect.any(String), expect.objectContaining({ ssl: { ca, rejectUnauthorized: true } }));
  const local = createDb("postgres://localhost/db");
  onTestFinished(local.close);
  expect(postgres).toHaveBeenLastCalledWith(expect.any(String), expect.objectContaining({ ssl: false }));
});

it.each(["anon", "authenticated"])("denies the %s browser role access to arcie.users", async (role) => {
  const { db } = await createTestDb();
  await expect(db.transaction(async (tx) => {
    await tx.execute(sql.raw(`set local role ${role}`));
    const [identity] = await tx.execute<{ current_user: string }>(sql`select current_user`);
    expect(identity?.current_user).toBe(role);
    await tx.execute(sql`select * from arcie.users`);
  })).rejects.toMatchObject({ cause: { code: "42501", message: "permission denied for schema arcie" } });
});

it("lets the restricted runtime role use application DML and sequences", async () => {
  const { db } = await createTestDb();
  await db.transaction(async (tx) => {
    await tx.execute(sql`set local role arcie_runtime`);
    await tx.execute(sql`insert into arcie.users (id, display_name, home_chain, created_at) values ('role-test', 'User', 'Arc_Testnet', '2026-11-20T00:00:00.000Z')`);
    expect(await tx.execute(sql`select display_name from arcie.users where id = 'role-test'`)).toEqual([{ display_name: "User" }]);
    expect(await tx.execute(sql`update arcie.users set display_name = 'Updated' where id = 'role-test' returning display_name`)).toEqual([{ display_name: "Updated" }]);
    expect(await tx.execute(sql`delete from arcie.users where id = 'role-test' returning id`)).toEqual([{ id: "role-test" }]);
    expect(await tx.execute(sql`select nextval('arcie.audit_id_seq')::int as id`)).toEqual([{ id: 1 }]);
  });
  const [role] = await db.execute(sql`select rolcanlogin, rolbypassrls, rolsuper, rolcreatedb, rolcreaterole from pg_roles where rolname = 'arcie_runtime'`);
  expect(role).toEqual({ rolcanlogin: false, rolbypassrls: false, rolsuper: false, rolcreatedb: false, rolcreaterole: false });
});

it("enables RLS on every application table with a single runtime-only policy", async () => {
  const { db } = await createTestDb();
  const tables = await db.execute<{ name: string; rls: boolean }>(sql`
    select relname as name, relrowsecurity as rls
    from pg_class join pg_namespace on pg_namespace.oid = relnamespace
    where nspname = 'arcie' and relkind in ('r', 'p')
    order by relname
  `);
  expect(tables.length).toBeGreaterThan(0);
  expect(tables.every(({ rls }) => rls)).toBe(true);

  const policies = await db.execute(sql`
    select tablename as name, roles::text, cmd, qual, with_check
    from pg_policies where schemaname = 'arcie' order by tablename
  `);
  expect(policies).toEqual(tables.map(({ name }) => ({
    name, roles: "{arcie_runtime}", cmd: "ALL", qual: "true", with_check: "true",
  })));
});


it.each([
  "postgres://127.0.0.1/app?host=remote.example.invalid",
  "postgres://remote.example.invalid:6543/app?port=5432",
  "postgres://127.0.0.1/app?sslrootcert=/synthetic-fixture/missing.crt",
  "postgres://127.0.0.1/app?sslcert=/synthetic-fixture/missing.crt",
  "postgres://127.0.0.1/app?sslkey=/synthetic-fixture/missing.key",
  "postgres://first.example.invalid,second.example.invalid/app",
  "postgres://%2Fsynthetic-fixture/app",
])("rejects ambiguous host, port or certificate file options before opening either client", async (url) => {
  vi.mocked(postgres).mockClear();
  let client: ReturnType<typeof createDb> | undefined;
  try {
    expect(() => { client = createDb(url); }).toThrow(/Postgres connection URL/);
    await expect(migrateDb(url)).rejects.toThrow(/Postgres connection URL/);
    expect(postgres).not.toHaveBeenCalled();
  } finally {
    await client?.close();
  }
});

it("pins an omitted port to 5432 instead of inheriting PGPORT", async () => {
  const url = "postgres://localhost/app";
  vi.stubEnv("PGPORT", "1");
  try {
    const runtime = createDb(url);
    onTestFinished(runtime.close);
    expect(postgres).toHaveBeenLastCalledWith(url, expect.objectContaining({ host: ["localhost"], port: 5432 }));

    const controller = new Error("config captured without a connection");
    vi.mocked(postgres).mockImplementationOnce(() => { throw controller; });
    await expect(migrateDb(url)).rejects.toBe(controller);
    expect(postgres).toHaveBeenLastCalledWith(url, expect.objectContaining({ host: ["localhost"], port: 5432 }));
  } finally {
    vi.unstubAllEnvs();
  }
});

it("refuses migration connections through the transaction pooler before creating a client", async () => {
  vi.mocked(postgres).mockClear();
  await expect(migrateDb("postgres://localhost:6543/app")).rejects.toThrow(/direct or session-mode/);
  expect(postgres).not.toHaveBeenCalled();
});

it.each(["LOGIN", "BYPASSRLS", "SUPERUSER", "CREATEDB", "CREATEROLE", "REPLICATION"])(
  "rejects an existing arcie_runtime role with %s",
  async (attribute) => {
    const { db } = await createTestDb();
    const migration = await readFile(new URL("../drizzle/0006_roles_rls.sql", import.meta.url), "utf8");
    await expect(db.transaction(async (tx) => {
      // The transaction rolls back the cluster-wide change even if the migration accepts it.
      await tx.execute(sql.raw(`ALTER ROLE arcie_runtime ${attribute}`));
      await tx.execute(sql.raw(migration.split("--> statement-breakpoint")[0]!));
    })).rejects.toMatchObject({ cause: { message: expect.stringContaining("arcie_runtime has incompatible role attributes") } });
  },
);

it("accepts an existing compatible arcie_runtime role without changing its identity", async () => {
  const { db } = await createTestDb();
  const migration = await readFile(new URL("../drizzle/0006_roles_rls.sql", import.meta.url), "utf8");
  const roleId = sql`select oid from pg_roles where rolname = 'arcie_runtime'`;
  await db.transaction(async (tx) => {
    const before = await tx.execute(roleId);
    await tx.execute(sql.raw(migration.split("--> statement-breakpoint")[0]!));
    expect(await tx.execute(roleId)).toEqual(before);
  });
});
