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

/** Resolves a single TCP endpoint used for both validation and the driver connection. */
export function databaseEndpoint(url: string): { host: string; port: number; loopback: boolean } {
  const parsed = URL.parse(url);
  if (!parsed || !/^postgres(?:ql)?:\/\//i.test(url) || parsed.hash ||
      !/^(?:[a-z0-9._-]+|\[[a-f0-9:.]+\])$/i.test(parsed.hostname)) {
    throw new Error("Postgres connection URL must specify a single TCP host.");
  }
  for (const name of ["host", "port", "sslcert", "sslkey", "sslrootcert"]) {
    if (parsed.searchParams.has(name)) {
      throw new Error("Postgres connection URL must specify host and port in its authority and use DATABASE_SSL_CA for CA certificates.");
    }
  }
  const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  const port = parsed.port === "" ? 5432 : Number(parsed.port);
  if (port === 0) throw new Error("Postgres connection URL must specify a valid port.");
  return { host, port, loopback: host === "localhost" || host === "127.0.0.1" || host === "::1" };
}

export function databaseTls(loopback: boolean, options: Pick<DbOptions, "ssl" | "sslCa"> = {}): postgres.Options<{}>["ssl"] {
  const required = options.ssl ?? !loopback;
  return required ? { rejectUnauthorized: true, ...(options.sslCa ? { ca: options.sslCa } : {}) } : false;
}

/** Opens a pool without migrating. Supavisor in transaction mode needs unnamed, serial queries. */
export function createDb(url: string, opts: DbOptions = {}): { db: Db; close(): Promise<void> } {
  const { host, port, loopback } = databaseEndpoint(url);
  const sql = postgres(url, {
    host: [host],
    port,
    max: opts.max ?? 3,
    prepare: false,
    ssl: databaseTls(loopback, opts),
    ...(port === 6543 ? { max_pipeline: 1, connect_timeout: 5, query_timeout: 10 } : {}),
    onnotice: () => {},
  });
  const db = drizzle(sql, { schema });
  return { db, close: () => sql.end({ timeout: 5 }) };
}
