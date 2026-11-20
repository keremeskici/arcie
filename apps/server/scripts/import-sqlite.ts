import { realpathSync } from "node:fs";
import { resolve, sep } from "node:path";
import {
  audit, choices, confirmClaims, contacts, createDb, databaseEndpoint, intents, limits,
  sessionEvents, sessions, sessionState, users, walletProvisioning, wallets,
  type Db, type Tx,
} from "@arcie/db";
import Database from "better-sqlite3";
import { getTableColumns, getTableName, sql, type SQL } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";
import type { SQLiteTable } from "drizzle-orm/sqlite-core";
import * as legacy from "../../../packages/db/src/sqlite-schema.js";

// The source has foreign keys to users. Postgres-only coordination tables start fresh.
const legacyTables = [
  [legacy.users, users],
  [legacy.wallets, wallets],
  [legacy.contacts, contacts],
  [legacy.limits, limits],
  [legacy.sessions, sessions],
  [legacy.intents, intents],
  [legacy.choices, choices],
  [legacy.audit, audit],
] as const;
const targetTables = [
  ...legacyTables.map(([, table]) => table),
  sessionState, sessionEvents, confirmClaims, walletProvisioning,
];
const BATCH_SIZE = 500;

/** Safe to report without exposing the cause, which can include record values or connection settings. */
class ImportError extends Error {}

function postgresError(error: unknown) {
  return (error instanceof Error ? error.cause : undefined) as
    { code?: string; constraint_name?: string } | undefined;
}

function quoteSqliteIdentifier(name: string) {
  return `"${name.replaceAll('"', '""')}"`;
}

function openBackup(path: string) {
  const checkPath = (candidate: string) => {
    if (candidate.split(sep).some((part) => part === "recovery" || part === ".env" || part.startsWith(".env."))) {
      throw new ImportError("SOURCE_PATH_FORBIDDEN");
    }
    return candidate;
  };
  try {
    const backup = checkPath(realpathSync(checkPath(resolve(path))));
    return new Database(backup, { readonly: true, fileMustExist: true });
  } catch (error) {
    if (error instanceof ImportError) throw error;
    throw new ImportError("SOURCE_OPEN_FAILED");
  }
}

function checkSourceTables(source: Database.Database) {
  const tables = source.prepare<[], { name: string }>(`
    select name from main.sqlite_schema
    where type = 'table' and name not glob 'sqlite_*' and name <> '__drizzle_migrations'
  `).all();
  const known = new Set<string>(legacyTables.map(([table]) => getTableName(table)));
  if (tables.length !== known.size || tables.some(({ name }) => !known.has(name))) {
    throw new ImportError("SOURCE_SCHEMA_MISMATCH");
  }
}

async function copyTable(tx: Tx, source: Database.Database, from: SQLiteTable, into: PgTable) {
  const name = getTableName(from);
  const sourceColumns = Object.entries(getTableColumns(from));
  const targetColumns = getTableColumns(into);
  const actualColumns = source.prepare<[string], { name: string }>("select name from pragma_table_xinfo(?)")
    .all(name).map((column) => column.name);
  if (actualColumns.length !== sourceColumns.length || sourceColumns.some(([key, column]) =>
    !actualColumns.includes(column.name) || !targetColumns[key]
  )) {
    throw new ImportError(`SOURCE_SCHEMA_MISMATCH (${name})`);
  }

  const columns = sql.join(sourceColumns.map(([key]) => sql.identifier(targetColumns[key]!.name)), sql`, `);
  const columnNames = sourceColumns.map(([, column]) => quoteSqliteIdentifier(column.name)).join(", ");
  const rows = source.prepare<[], Record<string, unknown>>(`
    select ${columnNames} from main.${quoteSqliteIdentifier(name)}
  `).safeIntegers().iterate();
  const identityOverride = into === audit ? sql`overriding system value` : sql.empty();
  let batch: SQL[] = [];
  let count = 0;
  const flush = async () => {
    try {
      await tx.execute(sql`
        insert into ${into} (${columns}) ${identityOverride} values ${sql.join(batch, sql`, `)}
      `);
    } catch (error) {
      // Drizzle's error includes bound values. Only expose known constraint categories.
      const cause = postgresError(error);
      if (cause?.code === "23503") throw new ImportError(`SOURCE_USER_REFERENCE_INVALID (${name})`);
      if (cause?.constraint_name === "intents_one_pending_per_session") {
        throw new ImportError("SOURCE_PENDING_INTENT_CONFLICT");
      }
      throw new ImportError(`IMPORT_FAILED (${name})`);
    }
    batch = [];
  };

  for (const row of rows) {
    const values = sourceColumns.map(([, column]) => {
      const value = row[column.name];
      if (value === null && !column.notNull) return sql`null`;
      if (typeof value === "bigint" && column.dataType === "number") return sql`${value.toString()}`;
      if (typeof value !== "string" || !["string", "json"].includes(column.dataType) || value.includes("\0")) {
        throw new ImportError(`SOURCE_ROW_INVALID (${name})`);
      }
      // Let Postgres parse the original text so large JSON numbers never pass through a JS number.
      return column.dataType === "json" ? sql`${value}::jsonb` : sql`${value}`;
    });
    batch.push(sql`(${sql.join(values, sql`, `)})`);
    count++;
    if (batch.length === BATCH_SIZE) await flush();
  }
  if (batch.length) await flush();
  return count;
}

async function importBackup(source: Database.Database, tx: Tx): Promise<Record<string, number>> {
  // A single read snapshot spans schema checks, table scans, and the derived session count.
  source.exec("begin");
  checkSourceTables(source);
  const counts: Record<string, number> = {};
  for (const [from, into] of legacyTables) {
    counts[getTableName(into)] = await copyTable(tx, source, from, into);
  }

  await tx.execute(sql`
    insert into ${sessionState} (session_id, proposal_generation, next_event_seq)
    select distinct session_id, 0, 1 from ${intents}
  `);
  counts.session_state = source.prepare<[], { count: number }>(
    "select count(distinct session_id) as count from main.intents",
  ).get()!.count;
  counts.session_events = 0;
  counts.confirm_claims = 0;
  counts.wallet_provisioning = 0;

  for (const table of targetTables) {
    const name = getTableName(table);
    const [result] = await tx.execute<{ count: string }>(sql`select count(*)::text as count from ${table}`);
    if (Number(result?.count) !== counts[name]) throw new ImportError(`COUNT_MISMATCH (${name})`);
  }
  for (const table of [intents, wallets, contacts]) {
    const [result] = await tx.execute<{ orphaned: boolean }>(sql`
      select exists (
        select 1 from ${table} left join ${users} on ${table.userId} = ${users.id} where ${users.id} is null
      ) as orphaned
    `);
    if (result?.orphaned !== false) throw new ImportError(`SOURCE_USER_REFERENCE_INVALID (${getTableName(table)})`);
  }
  const [identity] = await tx.execute<{ next: string }>(
    sql`select (coalesce(max(id), 0) + 1)::text as next from ${audit}`,
  );
  const nextId = BigInt(identity!.next);
  // RESTART is transactional. setval would outlive a later transaction rollback.
  await tx.execute(sql`alter table ${audit} alter column id restart with ${sql.raw(nextId.toString())}`);
  return counts;
}

export async function importSqlite({ sqlitePath, target }: {
  sqlitePath: string;
  target: Db;
}): Promise<{ counts: Record<string, number> }> {
  try {
    return await target.transaction(async (tx) => {
      // Lock in a fixed order, including the audit table that needs an exclusive lock for RESTART.
      // READ COMMITTED sees any writer that committed while these locks were being acquired.
      await tx.execute(sql`lock table ${sql.join(targetTables, sql`, `)} in access exclusive mode`);
      await tx.execute(sql`set local row_security = off`);
      for (const table of targetTables) {
        const [result] = await tx.execute<{ occupied: boolean }>(sql`
          select exists (select 1 from ${table}) as occupied
        `);
        if (result?.occupied !== false) throw new ImportError("TARGET_NOT_EMPTY");
      }

      const source = openBackup(sqlitePath);
      try {
        return { counts: await importBackup(source, tx) };
      } finally {
        source.close();
      }
    }, { isolationLevel: "read committed" });
  } catch (error) {
    if (error instanceof ImportError) throw error;
    if (postgresError(error)?.code === "42501") throw new ImportError("TARGET_OWNER_REQUIRED");
    throw new ImportError("IMPORT_FAILED");
  }
}

async function main() {
  const [, , sqlitePath, ...extra] = process.argv;
  if (!sqlitePath || extra.length) throw new ImportError("Usage: pnpm db:import-sqlite <backup.db>");

  const url = process.env.DATABASE_MIGRATION_URL;
  if (!url) throw new ImportError("Set DATABASE_MIGRATION_URL to a dedicated Postgres connection.");
  let port: number;
  try {
    ({ port } = databaseEndpoint(url));
  } catch {
    throw new ImportError("DATABASE_MIGRATION_URL must use a single TCP endpoint.");
  }
  if (port === 6543) throw new ImportError("DATABASE_MIGRATION_URL must use a direct or session-mode connection.");

  const { db, close } = createDb(url, { max: 1, sslCa: process.env.DATABASE_SSL_CA });
  let counts: Record<string, number>;
  try {
    ({ counts } = await importSqlite({ sqlitePath: resolve(process.env.INIT_CWD ?? process.cwd(), sqlitePath), target: db }));
  } finally {
    await close();
  }
  for (const [table, count] of Object.entries(counts)) console.log(`${table} ${count}`);
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    console.error(error instanceof ImportError ? error.message : "IMPORT_FAILED");
    process.exitCode = 1;
  });
}
