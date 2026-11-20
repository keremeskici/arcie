import { migrateDb } from "@arcie/db";

const url = process.env.DATABASE_MIGRATION_URL;
if (!url || !/^postgres(?:ql)?:\/\/[^/]/.test(url)) {
  throw new Error("Set DATABASE_MIGRATION_URL to a dedicated Postgres connection.");
}
if (new URL(url).port === "6543") {
  throw new Error("DATABASE_MIGRATION_URL must use a direct or session-mode connection.");
}
await migrateDb(url, { sslCa: process.env.DATABASE_SSL_CA });
