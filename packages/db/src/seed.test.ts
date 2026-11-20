import { DEFAULT_LIMITS } from "@arcie/core";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createTestDb } from "./testing.js";
import { contacts, limits, users } from "./schema.js";
import { seed } from "./seed.js";

describe("seed", () => {
  it("is idempotent and creates the demo user, three contacts and default limits", async () => {
    const { db } = await createTestDb();
    await seed(db, { userId: "demo" });
    await seed(db, { userId: "demo" });

    const allUsers = await db.select().from(users);
    expect(allUsers).toHaveLength(1);
    expect(allUsers[0]).toMatchObject({ id: "demo", homeChain: "Arc_Testnet" });

    const allContacts = await db.select().from(contacts).where(eq(contacts.userId, "demo"));
    expect(allContacts.map((c) => c.name).sort()).toEqual(["Alice", "Alice Smith", "Bob"]);
    for (const c of allContacts) expect(c.address).toMatch(/^0x[0-9a-fA-F]{40}$/);

    const limitRows = await db.select().from(limits);
    expect(limitRows).toHaveLength(1);
    expect(limitRows[0]!.json).toEqual(DEFAULT_LIMITS);
  });
});
