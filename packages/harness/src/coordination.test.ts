import { FakeAppKit, type WalletRef } from "@arcie/appkit";
import { createDb, intents, choices, seed, sessionState, wallets, type Db } from "@arcie/db";
import { createTestDb } from "@arcie/db/testing";
import { eq, sql } from "drizzle-orm";
import { describe, expect, it, onTestFinished } from "vitest";
import type { HarnessCtx } from "./context.js";
import { EventBus } from "./events.js";
import { createHarness } from "./harness.js";
import { DbPolicyProvider } from "./policy/db-provider.js";

const W: WalletRef = { chain: "Arc_Testnet", address: "0x000000000000000000000000000000000000dEaD", circleWalletId: "w1" };
const T0 = new Date("2026-11-07T10:00:00.000Z");

/** Two harness "instances" (separate pools, kits and buses) sharing one Postgres database. */
async function twoInstances() {
  const { db: dbA, url } = await createTestDb();
  const b = createDb(url, { max: 5 });
  onTestFinished(() => b.close());
  await seed(dbA, { userId: "demo" });
  await dbA.insert(wallets).values({ id: "w1", userId: "demo", chain: "Arc_Testnet", circleWalletId: "w1", address: W.address, accountType: "EOA" });
  const make = (db: typeof dbA) => {
    const kit = new FakeAppKit();
    kit.setBalance(W, "USDC", "100");
    kit.setBalance(W, "EURC", "20");
    return { kit, h: createHarness({ db, kit, policy: new DbPolicyProvider(db), bus: new EventBus() }) };
  };
  const ctx = (over: Partial<HarnessCtx> = {}): HarnessCtx => ({
    userId: "demo", sessionId: "s1", channel: "voice", userTurn: 1, now: () => T0, runId: `r${Math.random()}`, ...over,
  });
  return { dbA, a: make(dbA), b: make(b.db), ctx };
}

/** Holds the first estimate open until `release()`. */
function latch(kit: FakeAppKit) {
  let release!: () => void;
  let entered!: () => void;
  const started = new Promise<void>((r) => { entered = r; });
  const gate = new Promise<void>((r) => { release = r; });
  const original = kit.estimateSend.bind(kit);
  let n = 0;
  kit.estimateSend = async (w, p) => { if (++n === 1) { entered(); await gate; } return original(w, p); };
  return { started, release };
}

describe("database-coordinated proposals", () => {
  it("cancel on another instance stops a delayed proposal", async () => {
    const { dbA, a, b, ctx } = await twoInstances();
    const gate = latch(a.kit);
    const pending = a.h.propose(ctx(), "send", { to: "Bob", amount: "5", token: "USDC" });
    await gate.started;
    const cancelled = await b.h.cancel(ctx());
    expect(cancelled.summary).toMatch(/stopped preparing/);
    gate.release();
    const r = await pending;
    expect(r.data).toMatchObject({ cancelled: true });
    expect((await dbA.select().from(intents).where(eq(intents.status, "awaiting_confirmation")))).toHaveLength(0);
    expect(await dbA.select().from(choices)).toHaveLength(0);
    expect(await dbA.select().from(intents)).toHaveLength(0);
  });

  it("newer proposal wins on another instance", async () => {
    const { dbA, a, b, ctx } = await twoInstances();
    const gate = latch(a.kit);
    const first = a.h.propose(ctx(), "send", { to: "Bob", amount: "5", token: "USDC" });
    await gate.started;
    await b.h.propose(ctx({ userTurn: 2 }), "send", { to: "Bob", amount: "6", token: "USDC" });
    gate.release();
    expect((await first).data).toMatchObject({ cancelled: true });
    const open = await dbA.select().from(intents).where(eq(intents.status, "awaiting_confirmation"));
    expect(open).toHaveLength(1);
    expect(open[0]!.params.amount).toBe("6");
  });

  it("database refuses two pending intents", async () => {
    const { dbA } = await twoInstances();
    const row = (id: string) => ({
      id, sessionId: "s1", userId: "demo", kind: "send" as const, chain: "Arc_Testnet" as const,
      params: {}, paramsHash: "h", status: "awaiting_confirmation" as const,
    });
    await dbA.insert(intents).values(row("i1"));
    await expect(dbA.insert(intents).values(row("i2"))).rejects.toMatchObject({
      cause: { code: "23505", constraint_name: "intents_one_pending_per_session" },
    });
  });

  it("parallel proposals leave one card", async () => {
    const { dbA, a, b, ctx } = await twoInstances();
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        (i % 2 ? a : b).h.propose(ctx({ userTurn: i + 1 }), "send", { to: "Bob", amount: String(i + 1), token: "USDC" }),
      ),
    );
    const rows = await dbA.select().from(intents);
    expect(rows.filter((r) => r.status === "awaiting_confirmation")).toHaveLength(1);
    for (const r of rows.filter((r) => r.status !== "awaiting_confirmation")) {
      expect(r.status).toBe("cancelled");
      expect(r.statusReason).toBe("superseded");
    }
    const cancelledResults = results.filter((r) => (r.data as { cancelled?: boolean } | undefined)?.cancelled === true);
    expect(cancelledResults.length + rows.length).toBe(10);
  });

  describe("cancel serializes with publish", () => {
    const lockWaiters = async (db: Db) => {
      const rows = await db.execute<{ n: number }>(sql`select count(*)::int as n from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock'`);
      return rows[0]!.n;
    };
    const waitForWaiters = async (db: Db, n: number) => {
      for (let i = 0; i < 400; i++) {
        if ((await lockWaiters(db)) >= n) return;
        await new Promise((r) => setTimeout(r, 10));
      }
      throw new Error(`timed out waiting for ${n} lock waiters`);
    };

    // Holds the session_state row lock while A's publish and B's cancel both queue on it.
    it.each([false, true])("a cancel issued while a proposal is publishing leaves no live card (prior card: %s)", async (priorCard) => {
      const { dbA, a, b, ctx } = await twoInstances();
      if (priorCard) await b.h.propose(ctx(), "send", { to: "Bob", amount: "4", token: "USDC" });
      const gate = latch(a.kit);
      const proposal = a.h.propose(ctx({ userTurn: 2 }), "send", { to: "Bob", amount: "5", token: "USDC" });
      await gate.started;

      let releaseLock!: () => void;
      let locked!: () => void;
      const hasLock = new Promise<void>((r) => { locked = r; });
      const hold = new Promise<void>((r) => { releaseLock = r; });
      const holder = dbA.transaction(async (tx) => {
        await tx.select().from(sessionState).where(eq(sessionState.sessionId, "s1")).for("update");
        locked();
        await hold;
      });
      await hasLock;
      gate.release();
      await waitForWaiters(dbA, 1); // A is at publishProposal
      const cancelled = b.h.cancel(ctx({ userTurn: 3 }));
      await waitForWaiters(dbA, 2); // and the cancel is queued behind it
      releaseLock();
      await holder;
      const [published, result] = await Promise.all([proposal, cancelled]);

      expect(await dbA.select().from(intents).where(eq(intents.status, "awaiting_confirmation"))).toHaveLength(0);
      // Whichever won the lock, the user is never told "nothing to cancel" while a card is live.
      expect(result.summary).not.toMatch(/nothing to cancel/);
      void published;
    });
  });
});
