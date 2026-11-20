import { migrateDb } from "@arcie/db";

const url = process.env.DATABASE_MIGRATION_URL;
if (!url) {
  throw new Error("Set DATABASE_MIGRATION_URL to a dedicated Postgres connection.");
}
await migrateDb(url, { sslCa: process.env.DATABASE_SSL_CA });
