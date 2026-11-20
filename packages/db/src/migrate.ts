import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { databaseEndpoint, databaseTls, type DbOptions } from "./client.js";

const MIGRATIONS = fileURLToPath(new URL("../drizzle", import.meta.url));

/** Applies pending migrations over a dedicated single connection. Run explicitly, never on app startup. */
export async function migrateDb(url: string, options: Pick<DbOptions, "sslCa"> = {}): Promise<void> {
  const { host, port, loopback } = databaseEndpoint(url);
  if (port === 6543) {
    throw new Error("DATABASE_MIGRATION_URL must use a direct or session-mode connection.");
  }
  const sql = postgres(url, { host: [host], port, max: 1, prepare: false, ssl: databaseTls(loopback, options), onnotice: () => {} });
  try {
    await migrate(drizzle(sql), { migrationsFolder: MIGRATIONS });
  } finally {
    await sql.end({ timeout: 5 });
  }
}
