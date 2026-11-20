import { FakeAppKit, type WalletRef } from "@arcie/appkit";
import { createDb, intents, choices, seed, sessionState, wallets, type Db } from "@arcie/db";
import { createTestDb } from "@arcie/db/testing";
import { eq, sql } from "drizzle-orm";
import { describe, expect, it, onTestFinished } from "vitest";
import type { HarnessCtx } from "./context.js";
import { EventBus } from "./events.js";
import { createHarness } from "./harness.js";
import { claimConfirmation, releaseConfirmation } from "./coordination.js";
import { IntentRepo } from "./intents/repo.js";
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

describe("confirmation claims and fencing", () => {
  const row = (id: string) => ({
    id, sessionId: "s1", userId: "demo", kind: "send" as const, chain: "Arc_Testnet" as const,
    params: {}, paramsHash: "h", status: "awaiting_confirmation" as const,
  });
  const swapSetup = async () => {
    const s = await twoInstances();
    const p = await s.a.h.propose(s.ctx(), "swap", { tokenIn: "USDC", tokenOut: "EURC", amountIn: "10" });
    const id = (p.island as { intentId: string }).intentId;
    const later = (over: Partial<HarnessCtx> = {}) => s.ctx({ channel: "screen", now: () => new Date(T0.getTime() + 31_000), ...over });
    return { ...s, id, later };
  };
  /** Holds A's estimate open, then returns a quote below the slippage floor. */
  function swapLatch(kit: FakeAppKit) {
    let release!: () => void;
    let entered!: () => void;
    const started = new Promise<void>((r) => { entered = r; });
    const gate = new Promise<void>((r) => { release = r; });
    kit.estimateSwap = async () => { entered(); await gate; return { estimatedOut: "8", minOut: "7.92", fees: [] }; };
    return { started, release };
  }
  const swaps = (...kits: FakeAppKit[]) => kits.flatMap((k) => k.calls.filter((c) => c.method === "swap"));

  it("duplicate confirmations on two instances execute once", async () => {
    const { dbA, a, b, ctx } = await twoInstances();
    const p = await a.h.propose(ctx(), "send", { to: "Bob", amount: "5", token: "USDC" });
    const id = (p.island as { intentId: string }).intentId;
    let release!: () => void;
    let entered!: () => void;
    const started = new Promise<void>((r) => { entered = r; });
    const gate = new Promise<void>((r) => { release = r; });
    const send = a.kit.send.bind(a.kit);
    a.kit.send = async (w, params) => { entered(); await gate; return send(w, params); };
    const voice = a.h.confirm(ctx({ userTurn: 2 }), id, "voice");
    await started;
    const screen = await b.h.confirm(ctx({ channel: "screen", userTurn: 2 }), id, "screen");
    expect(screen.summary).toMatch(/already checking|Already on it/);
    release();
    expect((await voice).status).toBe("succeeded");
    const sends = [a.kit, b.kit].flatMap((k) => k.calls.filter((c) => c.method === "send"));
    expect(sends).toHaveLength(1);
    expect((await dbA.select().from(intents))[0]!.status).toBe("succeeded");
  });

  it("stale consent loses to a requote", async () => {
    const { dbA, a, b, id, later } = await swapSetup();
    const before = (await dbA.select().from(intents).where(eq(intents.id, id)))[0]!.revision;
    const gate = swapLatch(a.kit);
    const first = a.h.confirm(later(), id, "screen");
    await gate.started;
    const second = await b.h.confirm(later(), id, "screen"); // consent on the old quote
    expect(second.summary).toBe("I'm already checking that confirmation.");
    gate.release();
    const r = await first;
    expect(r.status).toBe("awaiting_confirmation");
    expect(swaps(a.kit, b.kit)).toHaveLength(0);
    const [intent] = await dbA.select().from(intents).where(eq(intents.id, id));
    expect(intent!.status).toBe("awaiting_confirmation");
    expect(intent!.params.minOut).toBe("7.92");
    expect(intent!.revision).toBe(before + 1);
  });

  it("cancel during preparation blocks execution", async () => {
    const { dbA, a, b, ctx, id, later } = await swapSetup();
    const gate = swapLatch(a.kit);
    const pending = a.h.confirm(later(), id, "screen");
    await gate.started;
    await b.h.cancel(ctx(), id);
    gate.release();
    await pending.catch(() => undefined);
    expect(swaps(a.kit, b.kit)).toHaveLength(0);
    expect((await dbA.select().from(intents).where(eq(intents.id, id)))[0]!.status).toBe("cancelled");
  });

  it("claim expiry ignores instance clock", async () => {
    const { a, b, id, later } = await swapSetup();
    const gate = swapLatch(a.kit);
    const first = a.h.confirm(later(), id, "screen");
    await gate.started;
    const skewed = await b.h.confirm(later({ now: () => new Date(T0.getTime() + 10 * 60_000) }), id, "screen");
    expect(skewed.summary).toBe("I'm already checking that confirmation.");
    gate.release();
    await first;
  });

  it("claims are exclusive and fence writes by token and revision", async () => {
    const { dbA } = await twoInstances();
    await dbA.insert(intents).values(row("i1"));
    const repo = new IntentRepo(dbA);
    const c1 = await claimConfirmation(dbA, "i1");
    expect(c1).toMatchObject({ revision: 0 });
    expect(await claimConfirmation(dbA, "i1")).toBeNull();
    expect(await repo.patchFenced("i1", { token: c1!.token, revision: 5 }, { preview: { x: 1 } })).toBe(false);
    expect(await repo.patchFenced("i1", c1!, { preview: { x: 1 } })).toBe(true);
    expect((await repo.get("i1"))!.revision).toBe(1);
    expect(await repo.patchFenced("i1", c1!, { preview: { x: 2 } })).toBe(false); // revision moved on
    await releaseConfirmation(dbA, "i1", "00000000-0000-0000-0000-000000000000"); // not ours: no-op
    expect(await claimConfirmation(dbA, "i1")).toBeNull();
    await releaseConfirmation(dbA, "i1", c1!.token);
    expect(await claimConfirmation(dbA, "i1")).not.toBeNull();
  });

  it("revision counts only changes to params, params_hash, preview or expires_at", async () => {
    const { dbA } = await twoInstances();
    await dbA.insert(intents).values(row("i1"));
    const repo = new IntentRepo(dbA);
    await repo.patch("i1", { quoteAt: "2026-11-07T10:00:00.000Z" });
    expect((await repo.get("i1"))!.revision).toBe(0);
    await repo.patch("i1", { expiresAt: "2026-11-07T10:02:00.000Z" });
    await repo.transition("i1", "awaiting_confirmation", "awaiting_confirmation", { params: { a: 1 }, paramsHash: "h2" });
    expect((await repo.get("i1"))!.revision).toBe(2);
  });

  it("expired claim can be taken over", async () => {
    const { dbA } = await twoInstances();
    await dbA.insert(intents).values(row("i1"));
    const repo = new IntentRepo(dbA);
    const first = await claimConfirmation(dbA, "i1", 1);
    await new Promise((r) => setTimeout(r, 50));
    const second = await claimConfirmation(dbA, "i1");
    expect(second).not.toBeNull();
    expect(second!.token).not.toBe(first!.token);
    expect(await repo.patchFenced("i1", first!, { preview: { x: 1 } })).toBe(false);
    expect(await repo.patchFenced("i1", second!, { preview: { x: 1 } })).toBe(true);
  });
});
