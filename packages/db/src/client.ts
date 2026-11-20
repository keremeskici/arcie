import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema.js";

export type Db = PostgresJsDatabase<typeof schema>;
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
/** Repos and audit accept either, so they can run inside a transaction. */
export type DbOrTx = Db | Tx;

export interface DbOptions {
  /** Pool size. Keep it small on serverless (the Supabase pooler multiplexes). */
  max?: number;
  ssl?: "require" | false;
}

/**
 * Opens a pooled connection. Never migrates (migrations run explicitly via `migrateDb`).
 * `prepare: false` keeps it compatible with the Supabase transaction pooler.
 */
export function createDb(url: string, opts: DbOptions = {}): { db: Db; close(): Promise<void> } {
  const sql = postgres(url, {
    max: opts.max ?? 5,
    prepare: false,
    ...(opts.ssl !== undefined ? { ssl: opts.ssl } : {}),
    onnotice: () => {},
  });
  const db = drizzle(sql, { schema });
  return { db, close: () => sql.end({ timeout: 5 }) };
}
