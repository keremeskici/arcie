import type { WalletCreator } from "@arcie/appkit";
import { DEFAULT_LIMITS } from "@arcie/core";
import { audit, createDb, limits, users, walletProvisioning, wallets } from "@arcie/db";
import { eq, sql } from "drizzle-orm";
import { createTestDb } from "@arcie/db/testing";
import { describe, expect, it } from "vitest";
import { onboard } from "./onboard.js";

function fakeCircle() {
  const byKey = new Map<string, { id: string; address: string }>();
  const keys: string[] = [];
  const circle: WalletCreator = {
    async createWallets(input) {
      keys.push(input.idempotencyKey);
      await new Promise((r) => setTimeout(r, 20));
      if (!byKey.has(input.idempotencyKey)) {
        const n = byKey.size + 1;
        byKey.set(input.idempotencyKey, { id: `cw-${n}`, address: `0x00000000000000000000000000000000000000c${n}` });
      }
      return { data: { wallets: [byKey.get(input.idempotencyKey)!] } };
    },
  };
  return { circle, created: () => byKey.size, keys };
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

  it("failed drip is not retried: the claim stays set and an audit row records it", async () => {
    const { db } = await createTestDb();
    let calls = 0;
    const drip = async () => {
      calls++;
      throw new Error("admin wallet empty");
    };
    const deps = { db, circle: fakeCircle().circle, walletSetId: "ws", drip };
    const first = await onboard(deps, KEREM);
    expect(first.dripTx).toBeNull();
    expect(first.user.welcomeDripAt).not.toBeNull();
    expect((await onboard(deps, KEREM)).dripTx).toBeNull();
    expect(calls).toBe(1);
    const rows = await db.select().from(audit).where(eq(audit.type, "welcome_drip.uncertain"));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.userId).toBe(KEREM.userId);
  });

  it("stores the drip transaction hash on success", async () => {
    const { db } = await createTestDb();
    const { user } = await onboard({ db, circle: fakeCircle().circle, walletSetId: "ws", drip: async () => "0xdrip" }, KEREM);
    const [row] = await db.select().from(users).where(eq(users.id, KEREM.userId));
    expect(row!.welcomeDripTx).toBe("0xdrip");
    expect(user.welcomeDripAt).not.toBeNull();
  });

  it("concurrent onboarding on two pools makes one wallet and one key", async () => {
    const { db, url } = await createTestDb();
    const second = createDb(url, { max: 3 });
    const { circle, keys } = fakeCircle();
    try {
      const [a, b] = await Promise.all([
        onboard({ db, circle, walletSetId: "ws" }, KEREM),
        onboard({ db: second.db, circle, walletSetId: "ws" }, KEREM),
      ]);
      expect(a.wallet.address).toBe(b.wallet.address);
      expect(await db.select().from(wallets)).toHaveLength(1);
      const [stored] = await db.select().from(walletProvisioning);
      expect(keys.length).toBeGreaterThanOrEqual(1);
      for (const k of keys) {
        expect(k).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
        expect(k).toBe(stored!.idempotencyKey);
      }
    } finally {
      await second.close();
    }
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
      await tx.select({ id: users.id }).from(users).where(eq(users.id, KEREM.userId)).for("no key update");
      locked();
      await hold;
    });
    await has;
    const done = onboard(deps, KEREM);
    let blocked = false;
    for (let i = 0; i < 250 && !blocked; i++) {
      const rows = await db.execute<{ n: number }>(sql`
        select count(*)::int as n from pg_stat_activity
        where datname = current_database() and wait_event_type = 'Lock' and pid <> pg_backend_pid() and query ilike '%for no key update%'`);
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

it("retains the submitted drip hash when the receipt wait fails and stores only a safe audit code", async () => {
  const { db } = await createTestDb();
  const drip = async (_address: string, submitted: (hash: string) => Promise<void>) => {
    await submitted("0xknown");
    throw new Error("synthetic-private-detail");
  };
  const result = await onboard({ db, circle: fakeCircle().circle, walletSetId: "ws", drip }, KEREM);
  expect(result.user.welcomeDripTx).toBe("0xknown");
  expect(result.dripTx).toBeNull();
  const rows = await db.select().from(audit).where(eq(audit.type, "welcome_drip.uncertain"));
  expect(rows).toHaveLength(1);
  expect(JSON.stringify(rows)).not.toContain("synthetic-private-detail");
});
