import { sql } from "drizzle-orm";
import postgres from "postgres";
import { expect, it, onTestFinished, vi } from "vitest";
import { createDb } from "./client.js";
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
