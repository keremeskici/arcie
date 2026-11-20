import { FakeAppKit, type WalletRef } from "@arcie/appkit";
import { ArcieError, DEFAULT_LIMITS } from "@arcie/core";
import { createDb, intents, limits, seed, users, wallets, type Db } from "@arcie/db";
import { createTestDb } from "@arcie/db/testing";
import { eq, sql } from "drizzle-orm";
import { describe, expect, it, onTestFinished } from "vitest";
import type { HarnessCtx } from "./context.js";
import { EventBus } from "./events.js";
import { audit } from "./audit.js";
import { claimConfirmation } from "./coordination.js";
import { createHarness } from "./harness.js";
import { IntentRepo } from "./intents/repo.js";
import { DbPolicyProvider } from "./policy/db-provider.js";

const W: WalletRef = { chain: "Arc_Testnet", address: "0x000000000000000000000000000000000000dEaD", circleWalletId: "w1" };
const T0 = new Date("2026-11-07T10:00:00.000Z");

/** Two harness "instances" (separate pools and kits) sharing one Postgres database and one user. */
async function setup(over: { dailyCapUsd?: number; maxPerTxUsd?: number } = {}) {
  const { db: dbA, url } = await createTestDb();
  const pb = createDb(url, { max: 5 });
  onTestFinished(() => pb.close());
  await seed(dbA, { userId: "demo" });
  await dbA.insert(wallets).values({ id: "w1", userId: "demo", chain: "Arc_Testnet", circleWalletId: "w1", address: W.address, accountType: "EOA" });
  await dbA.update(limits).set({ json: { ...DEFAULT_LIMITS, dailyCapUsd: over.dailyCapUsd ?? 10, maxPerTxUsd: over.maxPerTxUsd ?? 10 } });
  const make = (db: Db) => {
    const kit = new FakeAppKit();
    kit.setBalance(W, "USDC", "100");
    return { kit, h: createHarness({ db, kit, policy: new DbPolicyProvider(db), bus: new EventBus() }) };
  };
  const ctx = (sessionId: string, over: Partial<HarnessCtx> = {}): HarnessCtx => ({
    userId: "demo", sessionId, channel: "screen", userTurn: 1, now: () => T0, runId: `r${Math.random()}`, ...over,
  });
  const propose = async (s: ReturnType<typeof make>, sessionId: string, amount: string) => {
    const r = await s.h.propose(ctx(sessionId), "send", { to: "Bob", amount, token: "USDC" });
    return (r.island as { intentId: string }).intentId;
  };
  return { dbA, dbB: pb.db, a: make(dbA), b: make(pb.db), ctx, propose };
}

const sends = (kit: FakeAppKit) => kit.calls.filter((c) => c.method === "send");
const errOf = (p: Promise<unknown>) => p.then(() => null, (e: unknown) => e);

/** Waits until `n` backends are blocked on a lock by a statement matching `like`; fails loudly if never seen. */
async function waitForBlocked(db: Db, like: string, n: number) {
  for (let i = 0; i < 250; i++) {
    const rows = await db.execute<{ n: number }>(sql`
      select count(*)::int as n from pg_stat_activity
      where datname = current_database() and wait_event_type = 'Lock' and pid <> pg_backend_pid() and query ilike ${like}`);
    if (rows[0]!.n >= n) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error(`never observed ${n} backend(s) blocked on a lock matching ${like}`);
}

/** Holds the user's budget lock, as a limits writer would, until `release()`. */
async function holdBudgetLock(db: Db, whileHeld?: (tx: Parameters<Parameters<Db["transaction"]>[0]>[0]) => Promise<void>) {
  let release!: () => void;
  let locked!: () => void;
  const hold = new Promise<void>((r) => { release = r; });
  const has = new Promise<void>((r) => { locked = r; });
  const done = db.transaction(async (tx) => {
    await tx.select({ id: users.id }).from(users).where(eq(users.id, "demo")).for("no key update");
    await whileHeld?.(tx);
    locked();
    await hold;
  });
  await has;
  return { release, done };
}

describe("per-user budget lock", () => {
  it("separate intents share one budget", async () => {
    const s = await setup();
    const idA = await s.propose(s.a, "s1", "6");
    const idB = await s.propose(s.b, "s2", "6");
    const lock = await holdBudgetLock(s.dbA);
    const outA = errOf(s.a.h.confirm(s.ctx("s1"), idA, "screen"));
    const outB = errOf(s.b.h.confirm(s.ctx("s2"), idB, "screen"));
    await waitForBlocked(s.dbA, "%users%for no key update%", 2); // both confirms queue on the user's row
    lock.release();
    await lock.done;
    const [ea, eb] = await Promise.all([outA, outB]);
    const denied = [ea, eb].filter((e): e is ArcieError => e instanceof ArcieError);
    expect(denied).toHaveLength(1);
    expect(denied[0]!.code).toBe("POLICY_DENIED");
    expect(denied[0]!.spoken).toMatch(/daily limit/);
    expect(sends(s.a.kit).length + sends(s.b.kit).length).toBe(1);
    const rows = await s.dbA.select().from(intents);
    expect(rows.filter((r) => r.status === "succeeded")).toHaveLength(1);
    expect(rows.filter((r) => r.status === "awaiting_confirmation")).toHaveLength(1);
  });

  it("limits change between proposal and confirm", async () => {
    const s = await setup();
    const id = await s.propose(s.a, "s1", "6");
    await s.dbA.update(limits).set({ json: { ...DEFAULT_LIMITS, dailyCapUsd: 5, maxPerTxUsd: 5 } });
    expect(await errOf(s.a.h.confirm(s.ctx("s1"), id, "screen"))).toMatchObject({ code: "POLICY_DENIED" });
    expect(sends(s.a.kit)).toHaveLength(0);
  });

  it("a limits writer holding the budget lock is waited for, and its new limits apply", async () => {
    const s = await setup();
    const id = await s.propose(s.a, "s1", "6");
    const lock = await holdBudgetLock(s.dbA, async (tx) => {
      await tx.update(limits).set({ json: { ...DEFAULT_LIMITS, dailyCapUsd: 5, maxPerTxUsd: 5 } });
    });
    const out = errOf(s.a.h.confirm(s.ctx("s1"), id, "screen"));
    await waitForBlocked(s.dbA, "%users%for no key update%", 1);
    lock.release();
    await lock.done;
    expect(await out).toMatchObject({ code: "POLICY_DENIED" });
    expect(sends(s.a.kit)).toHaveLength(0);
  });

  it("kill after submit keeps reservation", async () => {
    // Regression pin: the reservation (executing + submission_unknown) already counted before the budget lock.
    const s = await setup();
    const id = await s.propose(s.a, "s1", "10");
    s.a.kit.failNext("CIRCLE_API_ERROR");
    const r = await s.a.h.confirm(s.ctx("s1"), id, "screen");
    expect(r.status).toBe("executing");
    const [row] = await s.dbA.select().from(intents).where(eq(intents.id, id));
    expect(row).toMatchObject({ status: "executing", statusReason: "submission_unknown" });
    expect(sends(s.a.kit)).toHaveLength(1);
    const next = await s.b.h.propose(s.ctx("s2"), "send", { to: "Bob", amount: "1", token: "USDC" });
    expect(next.summary).toMatch(/daily limit/);
    expect((await s.dbA.select().from(intents).where(eq(intents.sessionId, "s2")))[0]!.status).toBe("rejected");
  });

  it("no transaction spans the network call", async () => {
    const s = await setup();
    const id = await s.propose(s.a, "s1", "5");
    let release!: () => void;
    let entered!: () => void;
    const started = new Promise<void>((r) => { entered = r; });
    const gate = new Promise<void>((r) => { release = r; });
    const original = s.a.kit.send.bind(s.a.kit);
    s.a.kit.send = async (w, p) => { entered(); await gate; return original(w, p); };
    const out = s.a.h.confirm(s.ctx("s1"), id, "screen");
    await started;
    // While Circle is "in flight", another pool can take the user's row lock without waiting.
    let acquired = false;
    await s.dbB.transaction(async (tx) => {
      await tx.execute(sql`select id from arcie.users where id = 'demo' for no key update nowait`);
      acquired = true;
    });
    expect(acquired).toBe(true);
    expect(sends(s.a.kit)).toHaveLength(0); // still latched inside send
    release();
    expect((await out).status).toBe("succeeded");
  });

  // A cancel/publish transaction holds the intent row and then inserts audit rows (FK to users takes KEY SHARE on
  // the user). The budget lock must not conflict with that, or confirm (users -> intent) and cancel (intent -> users)
  // deadlock.
  it.each(["cancel", "publish"] as const)("a %s holding the intent row does not deadlock with an execution claim", async (kind) => {
    const s = await setup();
    const id = await s.propose(s.a, "s1", "5");
    let release!: () => void;
    let locked!: () => void;
    const hold = new Promise<void>((r) => { release = r; });
    const has = new Promise<void>((r) => { locked = r; });
    const other = s.dbB.transaction(async (tx) => {
      const repo = new IntentRepo(tx);
      if (kind === "cancel") await repo.transition(id, "awaiting_confirmation", "cancelled", { statusReason: "user" });
      else await repo.supersedeOpen("s1", "newer");
      locked();
      await hold;
      await audit(tx, s.ctx("s1"), `intent.${kind}`, {}, id);
      // Publishing inserts the new card: intents.user_id -> users takes KEY SHARE on the user row.
      if (kind === "publish") {
        await tx.insert(intents).values({
          id: "newer", sessionId: "s1", userId: "demo", kind: "send", chain: "Arc_Testnet",
          params: {}, paramsHash: "h", status: "rejected", usdValue: "1",
        });
      }
    });
    await has;
    const out = errOf(s.a.h.confirm(s.ctx("s1"), id, "screen"));
    await waitForBlocked(s.dbA, '%update "arcie"."intents"%', 1); // confirm holds the budget lock, waits on the intent row
    release();
    expect(await errOf(other)).toBeNull();
    const e = await out;
    expect(e === null || (e as { code?: string }).code !== "40P01").toBe(true);
    expect(String((e as { cause?: { code?: string } } | null)?.cause?.code ?? "")).not.toBe("40P01");
    expect(sends(s.a.kit)).toHaveLength(0);
    expect((await s.dbA.select().from(intents).where(eq(intents.id, id)))[0]!.status).toBe("cancelled");
  });

  it("a takeover that commits before the claim-row lock still stops execution", async () => {
    const s = await setup();
    const id = await s.propose(s.a, "s1", "5");
    const lock = await holdBudgetLock(s.dbA);
    const out = errOf(s.a.h.confirm(s.ctx("s1"), id, "screen"));
    await waitForBlocked(s.dbA, "%users%for no key update%", 1);
    await s.dbA.execute(sql`update arcie.confirm_claims set expires_at = now() - interval '1 second' where intent_id = ${id}`);
    expect(await claimConfirmation(s.dbA, id)).not.toBeNull(); // takeover commits before the confirm reaches the claim row
    lock.release();
    await lock.done;
    expect(await out).toMatchObject({ code: "POLICY_DENIED", spoken: "The details changed. Please check the new card and confirm again." });
    expect(sends(s.a.kit)).toHaveLength(0);
    expect((await s.dbA.select().from(intents).where(eq(intents.id, id)))[0]!.status).toBe("awaiting_confirmation");
  });
});
