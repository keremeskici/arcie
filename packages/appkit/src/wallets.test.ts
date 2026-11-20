import { audit, seed, wallets, walletProvisioning } from "@arcie/db";
import { createDb } from "@arcie/db";
import { eq } from "drizzle-orm";
import { createTestDb } from "@arcie/db/testing";
import { describe, expect, it } from "vitest";
import { ensureWallet, type WalletCreator } from "./wallets.js";

function fakeCreator() {
  const calls: unknown[] = [];
  const creator: WalletCreator = {
    async createWallets(input) {
      calls.push(input);
      return { data: { wallets: [{ id: "cw-1", address: "0x00000000000000000000000000000000000000c1" }] } };
    },
  };
  return { creator, calls };
}

describe("ensureWallet", () => {
  it("creates a Circle wallet once per user and chain and returns a WalletRef", async () => {
    const { db } = await createTestDb();
    await seed(db, { userId: "demo" });
    const { creator, calls } = fakeCreator();
    const opts = { userId: "demo", chain: "Arc_Testnet" as const, walletSetId: "ws-1", accountType: "EOA" as const };

    const first = await ensureWallet(db, creator, opts);
    const second = await ensureWallet(db, creator, opts);

    expect(first).toEqual({ chain: "Arc_Testnet", address: "0x00000000000000000000000000000000000000c1", circleWalletId: "cw-1" });
    expect(second).toEqual(first);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ walletSetId: "ws-1", blockchains: ["ARC-TESTNET"], count: 1, accountType: "EOA" });
    expect(await db.select().from(wallets)).toHaveLength(1);
  });

  it("replays one Circle creation when two calls race (same key on every call)", async () => {
    const { db } = await createTestDb();
    await seed(db, { userId: "demo" });
    const { creator, calls } = fakeCreator();
    const opts = { userId: "demo", chain: "Arc_Testnet" as const, walletSetId: "ws-1", accountType: "EOA" as const };
    const [a, b] = await Promise.all([ensureWallet(db, creator, opts), ensureWallet(db, creator, opts)]);
    expect(a).toEqual(b);
    expect(new Set(calls.map((c) => (c as { idempotencyKey: string }).idempotencyKey)).size).toBe(1);
    expect(await db.select().from(wallets)).toHaveLength(1);
  });

  it("fails clearly when Circle returns no wallet", async () => {
    const { db } = await createTestDb();
    await seed(db, { userId: "demo" });
    const creator: WalletCreator = { createWallets: async () => ({ data: { wallets: [] } }) };
    await expect(
      ensureWallet(db, creator, { userId: "demo", chain: "Arc_Testnet", walletSetId: "ws-1", accountType: "EOA" }),
    ).rejects.toMatchObject({ code: "CIRCLE_API_ERROR" });
  });
});

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe("wallet provisioning persistence", () => {
  const opts = { userId: "demo", chain: "Arc_Testnet" as const, walletSetId: "ws-1", accountType: "EOA" as const };

  it("retry after a Circle error reuses the same idempotency key", async () => {
    const { db } = await createTestDb();
    await seed(db, { userId: "demo" });
    const keys: string[] = [];
    let fail = true;
    const creator: WalletCreator = {
      async createWallets(input) {
        keys.push(input.idempotencyKey);
        if (fail) throw new Error("timeout");
        return { data: { wallets: [{ id: "cw-1", address: "0x00000000000000000000000000000000000000c1" }] } };
      },
    };
    await expect(ensureWallet(db, creator, opts)).rejects.toThrow("timeout");
    const [uncertain] = await db.select().from(walletProvisioning);
    expect(uncertain!.status).toBe("uncertain");
    fail = false;
    const ref = await ensureWallet(db, creator, opts);
    expect(ref.circleWalletId).toBe("cw-1");
    expect(keys).toHaveLength(2);
    expect(keys[1]).toBe(keys[0]);
    expect(keys[0]).toMatch(/^[0-9a-f-]{36}$/);
    const [done] = await db.select().from(walletProvisioning);
    expect(done).toMatchObject({ status: "created", idempotencyKey: keys[0] });
  });

  it("does not call Circle once the wallet is created", async () => {
    const { db } = await createTestDb();
    await seed(db, { userId: "demo" });
    const { creator, calls } = fakeCreator();
    await ensureWallet(db, creator, opts);
    await ensureWallet(db, creator, opts);
    expect(calls).toHaveLength(1);
  });

  it("two instances racing share one stored key", async () => {
    const { db, url } = await createTestDb();
    const second = createDb(url, { max: 3 });
    const db2 = second.db;
    await seed(db, { userId: "demo" });
    const keys: string[] = [];
    const byKey = new Map<string, { id: string; address: string }>();
    const creator: WalletCreator = {
      async createWallets(input) {
        keys.push(input.idempotencyKey);
        await new Promise((r) => setTimeout(r, 30));
        if (!byKey.has(input.idempotencyKey)) byKey.set(input.idempotencyKey, { id: `cw-${byKey.size + 1}`, address: `0x${(byKey.size + 1).toString(16).padStart(40, "c")}` });
        return { data: { wallets: [byKey.get(input.idempotencyKey)!] } };
      },
    };
    try {
      const [a, b] = await Promise.all([ensureWallet(db, creator, opts), ensureWallet(db2, creator, opts)]);
      expect(a).toEqual(b);
      const [stored] = await db.select().from(walletProvisioning);
      expect(keys.length).toBeGreaterThanOrEqual(1);
      for (const k of keys) {
        expect(k).toMatch(UUID);
        expect(k).toBe(stored!.idempotencyKey);
      }
      expect(await db.select().from(wallets)).toHaveLength(1);
    } finally {
      await second.close();
    }
  });

  it("uses the key another instance already stored (pending row, no in-process state)", async () => {
    const { db } = await createTestDb();
    await seed(db, { userId: "demo" });
    const K = "6f1c2a0e-3b4d-4e5f-8a9b-0c1d2e3f4a5b";
    await db.insert(walletProvisioning).values({ userId: "demo", chain: "Arc_Testnet", idempotencyKey: K, status: "pending" });
    const { creator, calls } = fakeCreator();
    await ensureWallet(db, creator, opts);
    expect(calls).toHaveLength(1);
    expect((calls[0] as { idempotencyKey: string }).idempotencyKey).toBe(K);
    expect(await db.select().from(wallets)).toHaveLength(1);
  });

  it("marks uncertain and audits when Circle returns a different wallet than the stored mapping", async () => {
    const { db } = await createTestDb();
    await seed(db, { userId: "demo" });
    const creator: WalletCreator = {
      async createWallets() {
        // Another instance stored its wallet meanwhile; Circle did not replay and returns a new one.
        await db.insert(wallets).values({ id: "cw-first", userId: "demo", chain: "Arc_Testnet", circleWalletId: "cw-first", address: "0x00000000000000000000000000000000000000f1", accountType: "EOA" });
        return { data: { wallets: [{ id: "cw-second", address: "0x00000000000000000000000000000000000000f2" }] } };
      },
    };
    const ref = await ensureWallet(db, creator, opts);
    expect(ref.circleWalletId).toBe("cw-first");
    const [prov] = await db.select().from(walletProvisioning);
    expect(prov!.status).toBe("uncertain");
    const rows = await db.select().from(audit).where(eq(audit.type, "wallet_provisioning.mismatch"));
    expect(rows).toHaveLength(1);
    expect(await db.select().from(wallets)).toHaveLength(1);
  });
});
