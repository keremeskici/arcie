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
  /** Optional certificate authority in PEM format. */
  sslCa?: string;
}

export function isLoopbackDatabase(url: string): boolean {
  const { hostname } = new URL(url);
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}

export function databaseTls(url: string, options: Pick<DbOptions, "ssl" | "sslCa"> = {}): postgres.Options<{}>["ssl"] {
  const required = options.ssl ?? !isLoopbackDatabase(url);
  return required ? { rejectUnauthorized: true, ...(options.sslCa ? { ca: options.sslCa } : {}) } : false;
}

/** Opens a pool without migrating. Supavisor in transaction mode needs unnamed, serial queries. */
export function createDb(url: string, opts: DbOptions = {}): { db: Db; close(): Promise<void> } {
  const transactionPooler = new URL(url).port === "6543";
  const sql = postgres(url, {
    max: opts.max ?? 3,
    prepare: false,
    ssl: databaseTls(url, opts),
    ...(transactionPooler ? { max_pipeline: 1, connect_timeout: 5, query_timeout: 10 } : {}),
    onnotice: () => {},
  });
  const db = drizzle(sql, { schema });
  return { db, close: () => sql.end({ timeout: 5 }) };
}
