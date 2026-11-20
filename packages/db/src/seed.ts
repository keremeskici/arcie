import { DEFAULT_LIMITS } from "@arcie/core";
import type { Db } from "./client.js";
import { contacts, limits, users } from "./schema.js";

/** Placeholder testnet recipients. "Alice" / "Alice Smith" is a deliberate near-duplicate (Review Focus 5). */
const DEMO_CONTACTS: { name: string; address: `0x${string}` }[] = [
  { name: "Alice", address: "0x1111111111111111111111111111111111111111" },
  { name: "Alice Smith", address: "0x2222222222222222222222222222222222222222" },
  { name: "Bob", address: "0x3333333333333333333333333333333333333333" },
];

export async function seed(db: Db, opts: { userId: string }): Promise<void> {
  const { userId } = opts;
  await db.transaction(async (tx) => {
    await tx.insert(users)
      .values({ id: userId, displayName: "Demo", homeChain: "Arc_Testnet" })
      .onConflictDoNothing();
    for (const c of DEMO_CONTACTS) {
      await tx.insert(contacts)
        .values({ id: `${userId}:${c.name.toLowerCase().replace(/\s+/g, "-")}`, userId, chain: "Arc_Testnet", ...c })
        .onConflictDoNothing();
    }
    await tx.insert(limits).values({ userId, json: DEFAULT_LIMITS }).onConflictDoNothing();
  });
}
