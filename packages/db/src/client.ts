import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { fileURLToPath } from "node:url";
import * as schema from "./schema.js";

export type Db = BetterSQLite3Database<typeof schema>;

const MIGRATIONS = fileURLToPath(new URL("../drizzle", import.meta.url));

/** Opens the database and applies pending migrations. Use ":memory:" in tests. */
export function createDb(url: string): Db {
  const sqlite = new Database(url);
  if (url !== ":memory:") sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: MIGRATIONS });
  return db;
}
