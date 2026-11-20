import { sql } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { createDb } from "./client.js";
import { intents, users } from "./schema.js";
import { createTestDb, withDatabase } from "./testing.js";

const closers: (() => Promise<void>)[] = [];
afterEach(async () => {
  await Promise.all(closers.splice(0).map((c) => c()));
});

async function open() {
  const t = await createTestDb();
  closers.push(t.close);
  return t;
}

describe("postgres client", () => {
  it("migrates into the private arcie schema", async () => {
    const { db } = await open();
    const tables = (await db.execute(sql`select table_schema, table_name from information_schema.tables`)) as unknown as {
      table_schema: string;
      table_name: string;
    }[];
    const app = ["users", "wallets", "contacts", "limits", "sessions", "intents", "choices", "audit"];
    const inArcie = tables.filter((t) => t.table_schema === "arcie").map((t) => t.table_name);
    const inPublic = tables.filter((t) => t.table_schema === "public").map((t) => t.table_name);
    for (const name of app) expect(inArcie).toContain(name);
    for (const name of app) expect(inPublic).not.toContain(name);
  });

  it("createDb never migrates", async () => {
    const { url } = await open();
    const { db, close } = createDb(withDatabase(url, "postgres"));
    closers.push(close);
    const rows = (await db.execute(sql`select to_regclass('arcie.users') as t`)) as unknown as { t: string | null }[];
    expect(rows[0]!.t).toBeNull();
  });

  it("round-trips jsonb and text timestamps", async () => {
    const { db } = await open();
    await db.insert(users).values({ id: "u1", displayName: "U", homeChain: "Arc_Testnet" });
    await db.insert(intents).values({
      id: "i1",
      sessionId: "s1",
      userId: "u1",
      kind: "send",
      chain: "Arc_Testnet",
      params: { amount: "1.000001" },
      paramsHash: "h",
      status: "awaiting_confirmation",
      createdAt: "2026-11-20T00:00:00.000Z",
      updatedAt: "2026-11-20T00:00:00.000Z",
    });
    const [row] = await db.select().from(intents);
    expect(row!.params).toEqual({ amount: "1.000001" });
    expect(typeof row!.params.amount).toBe("string");
    expect(row!.createdAt).toBe("2026-11-20T00:00:00.000Z");
  });

  it("two test databases are isolated", async () => {
    const a = await open();
    const b = await open();
    await a.db.insert(users).values({ id: "only-in-a", displayName: "A", homeChain: "Arc_Testnet" });
    expect(await a.db.select().from(users)).toHaveLength(1);
    expect(await b.db.select().from(users)).toHaveLength(0);
  });
});
