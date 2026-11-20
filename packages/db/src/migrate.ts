import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

const MIGRATIONS = fileURLToPath(new URL("../drizzle", import.meta.url));

/** Applies pending migrations over a dedicated single connection. Run explicitly, never on app startup. */
export async function migrateDb(url: string): Promise<void> {
  const sql = postgres(url, { max: 1, prepare: false, onnotice: () => {} });
  try {
    await migrate(drizzle(sql), { migrationsFolder: MIGRATIONS });
  } finally {
    await sql.end({ timeout: 5 });
  }
}
