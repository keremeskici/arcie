import type { WalletCreator } from "@arcie/appkit";
import { DEFAULT_LIMITS } from "@arcie/core";
import { createDb, limits, users, wallets } from "@arcie/db";
import { describe, expect, it } from "vitest";
import { onboard } from "./onboard.js";

function fakeCircle() {
  let n = 0;
  const circle: WalletCreator = {
    async createWallets() {
      n++;
      return { data: { wallets: [{ id: `cw-${n}`, address: `0x00000000000000000000000000000000000000c${n}` }] } };
    },
  };
  return { circle, created: () => n };
}

const KEREM = { userId: "did:privy:kerem", displayName: "Kerem", email: "k@x.io", linkedWallet: "0xBf879877e05430aC14fcEF6fE102DF29e264b114" as const };

describe("onboard", () => {
  it("is idempotent: one user, one limits row, one wallet, one drip", async () => {
    const db = createDb(":memory:");
    const { circle, created } = fakeCircle();
    const drips: string[] = [];
    const deps = { db, circle, walletSetId: "ws", drip: async (a: string) => (drips.push(a), "0xdrip") };

    const first = await onboard(deps, KEREM);
    const second = await onboard(deps, KEREM);

    expect(first.wallet).toEqual(second.wallet);
    expect(first.dripTx).toBe("0xdrip");
    expect(second.dripTx).toBeNull();
    expect(drips).toEqual([first.wallet.address]);
    expect(created()).toBe(1);
    expect(db.select().from(users).all()).toHaveLength(1);
    expect(db.select().from(limits).all().map((l) => l.json)).toEqual([DEFAULT_LIMITS]);
    expect(db.select().from(wallets).all()).toHaveLength(1);
    expect(first.limits).toEqual(DEFAULT_LIMITS);
  });

  it("stores the email and linked wallet", async () => {
    const db = createDb(":memory:");
    const { user } = await onboard({ db, circle: fakeCircle().circle, walletSetId: "ws" }, KEREM);
    expect(user).toMatchObject({ id: "did:privy:kerem", displayName: "Kerem", email: "k@x.io", linkedWallet: KEREM.linkedWallet, homeChain: "Arc_Testnet" });
  });

  it("finishes onboarding when the drip fails, and retries the drip next time", async () => {
    const db = createDb(":memory:");
    let fail = true;
    const drip = async () => {
      if (fail) throw new Error("admin wallet empty");
      return "0xlater";
    };
    const deps = { db, circle: fakeCircle().circle, walletSetId: "ws", drip };
    const first = await onboard(deps, KEREM);
    expect(first.dripTx).toBeNull();
    expect(first.user.welcomeDripAt).toBeNull();
    fail = false;
    expect((await onboard(deps, KEREM)).dripTx).toBe("0xlater");
  });

  it("drips only once when two logins race", async () => {
    const db = createDb(":memory:");
    let drips = 0;
    const deps = { db, circle: fakeCircle().circle, walletSetId: "ws", drip: async () => (drips++, "0xd") };
    await Promise.all([onboard(deps, KEREM), onboard(deps, KEREM)]);
    expect(drips).toBe(1);
  });
});
