/** Test-only helpers. Import from "@arcie/db/testing"; it is not part of the production entry point. */
import { randomBytes } from "node:crypto";
import postgres from "postgres";
import { inject, onTestFinished } from "vitest";
import { createDb, type Db } from "./client.js";
import { TEMPLATE_DB, withDatabase } from "./testing-shared.js";

declare module "vitest" {
  interface ProvidedContext {
    /** Admin URL (database `postgres`) of the Postgres server started by vitest.global-setup.ts. */
    arcieTestServerUrl: string;
  }
}

export { TEMPLATE_DB, withDatabase };

/**
 * A fresh, migrated database cloned from the template. `close()` (idempotent) ends the pool and drops the
 * database; when called inside a test it is also registered to run when that test finishes.
 */
export async function createTestDb(): Promise<{ db: Db; url: string; close(): Promise<void> }> {
  const serverUrl = inject("arcieTestServerUrl");
  const name = `t_${randomBytes(6).toString("hex")}`;
  const admin = postgres(serverUrl, { max: 1, prepare: false, onnotice: () => {} });
  try {
    await admin.unsafe(`CREATE DATABASE ${name} TEMPLATE ${TEMPLATE_DB}`);
  } finally {
    await admin.end({ timeout: 5 });
  }
  const url = withDatabase(serverUrl, name);
  const { db, close } = createDb(url, { max: 5 });
  let closed: Promise<void> | undefined;
  const closeAll = () =>
    (closed ??= (async () => {
      await close();
      const cleanup = postgres(serverUrl, { max: 1, prepare: false, onnotice: () => {} });
      try {
        await cleanup.unsafe(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
      } finally {
        await cleanup.end({ timeout: 5 });
      }
    })());
  try {
    onTestFinished(closeAll);
  } catch {
    // Not inside a test (for example a global hook): the caller closes it.
  }
  return { db, url, close: closeAll };
}
