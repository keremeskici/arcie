import type { WalletCreator } from "@arcie/appkit";
import { DEFAULT_LIMITS } from "@arcie/core";
import { limits, users, wallets } from "@arcie/db";
import { eq, sql } from "drizzle-orm";
import { createTestDb } from "@arcie/db/testing";
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
    const { db } = await createTestDb();
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
    expect(await db.select().from(users)).toHaveLength(1);
    expect((await db.select().from(limits)).map((l) => l.json)).toEqual([DEFAULT_LIMITS]);
    expect(await db.select().from(wallets)).toHaveLength(1);
    expect(first.limits).toEqual(DEFAULT_LIMITS);
  });

  it("stores the email and linked wallet", async () => {
    const { db } = await createTestDb();
    const { user } = await onboard({ db, circle: fakeCircle().circle, walletSetId: "ws" }, KEREM);
    expect(user).toMatchObject({ id: "did:privy:kerem", displayName: "Kerem", email: "k@x.io", linkedWallet: KEREM.linkedWallet, homeChain: "Arc_Testnet" });
  });

  it("finishes onboarding when the drip fails, and retries the drip next time", async () => {
    const { db } = await createTestDb();
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
    const { db } = await createTestDb();
    let drips = 0;
    const deps = { db, circle: fakeCircle().circle, walletSetId: "ws", drip: async () => (drips++, "0xd") };
    await Promise.all([onboard(deps, KEREM), onboard(deps, KEREM)]);
    expect(drips).toBe(1);
  });

  it("takes the user's budget lock before writing limits", async () => {
    const { db } = await createTestDb();
    const deps = { db, circle: fakeCircle().circle, walletSetId: "ws" };
    await onboard(deps, KEREM);
    await db.delete(limits);
    let release!: () => void;
    let locked!: () => void;
    const hold = new Promise<void>((r) => { release = r; });
    const has = new Promise<void>((r) => { locked = r; });
    const holder = db.transaction(async (tx) => {
      await tx.select({ id: users.id }).from(users).where(eq(users.id, KEREM.userId)).for("update");
      locked();
      await hold;
    });
    await has;
    const done = onboard(deps, KEREM);
    let blocked = false;
    for (let i = 0; i < 250 && !blocked; i++) {
      const rows = await db.execute<{ n: number }>(sql`
        select count(*)::int as n from pg_stat_activity
        where datname = current_database() and wait_event_type = 'Lock' and pid <> pg_backend_pid() and query ilike '%for update%'`);
      blocked = rows[0]!.n >= 1;
      if (!blocked) await new Promise((r) => setTimeout(r, 10));
    }
    expect(blocked).toBe(true); // onboard queued on the budget lock, as a limits writer must
    expect(await db.select().from(limits)).toHaveLength(0);
    release();
    await holder;
    expect((await done).limits).toEqual(DEFAULT_LIMITS);
  });
});
