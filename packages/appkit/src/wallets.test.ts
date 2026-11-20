import { createDb, seed, wallets } from "@arcie/db";
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
    const db = createDb(":memory:");
    await seed(db, { userId: "demo" });
    const { creator, calls } = fakeCreator();
    const opts = { userId: "demo", chain: "Arc_Testnet" as const, walletSetId: "ws-1", accountType: "EOA" as const };

    const first = await ensureWallet(db, creator, opts);
    const second = await ensureWallet(db, creator, opts);

    expect(first).toEqual({ chain: "Arc_Testnet", address: "0x00000000000000000000000000000000000000c1", circleWalletId: "cw-1" });
    expect(second).toEqual(first);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ walletSetId: "ws-1", blockchains: ["ARC-TESTNET"], count: 1, accountType: "EOA" });
    expect(db.select().from(wallets).all()).toHaveLength(1);
  });

  it("creates only one Circle wallet when two calls race", async () => {
    const db = createDb(":memory:");
    await seed(db, { userId: "demo" });
    const { creator, calls } = fakeCreator();
    const opts = { userId: "demo", chain: "Arc_Testnet" as const, walletSetId: "ws-1", accountType: "EOA" as const };
    const [a, b] = await Promise.all([ensureWallet(db, creator, opts), ensureWallet(db, creator, opts)]);
    expect(a).toEqual(b);
    expect(calls).toHaveLength(1);
  });

  it("fails clearly when Circle returns no wallet", async () => {
    const db = createDb(":memory:");
    await seed(db, { userId: "demo" });
    const creator: WalletCreator = { createWallets: async () => ({ data: { wallets: [] } }) };
    await expect(
      ensureWallet(db, creator, { userId: "demo", chain: "Arc_Testnet", walletSetId: "ws-1", accountType: "EOA" }),
    ).rejects.toMatchObject({ code: "CIRCLE_API_ERROR" });
  });
});
