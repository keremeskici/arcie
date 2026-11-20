import { audit, confirmClaims, createDb, intents } from "@arcie/db";
import { eq, sql } from "drizzle-orm";
import { IntentRepo } from "@arcie/harness";
import { describe, expect, it, vi } from "vitest";
import { reconcileIntent, reconcileUser } from "./reconcile.js";
import { DEMO_WALLET, latch, testApp } from "./testkit.js";

const NOW = new Date("2026-11-07T12:00:00.000Z");
const ago = (min: number) => new Date(NOW.getTime() - min * 60_000);

describe("reconcileUser", () => {
  it("settles a pending swap, reserves an orphan, and leaves a fresh one alone", async () => {
    const { db, kit, events } = await testApp();
    const repo = new IntentRepo(db);

    kit.setPendingNext();
    const tx = await kit.swap(DEMO_WALLET, { tokenIn: "USDC", tokenOut: "EURC", amountIn: "1", slippageBps: 100 });
    kit.settle(tx.txHash);

    const base = {
      sessionId: "s1",
      userId: "demo",
      chain: "Arc_Testnet" as const,
      preview: { estimated: { "You got": "0.92 EUR" } },
      status: "executing" as const,
      usdValue: "1",
      previewTurn: 0,
      ttlSec: 120,
    };
    const pending = await repo.create({ ...base, kind: "swap", params: { tokenIn: "USDC", tokenOut: "EURC", amountIn: "1", slippageBps: 100 }, now: ago(2) });
    await repo.patch(pending.id, { txHash: tx.txHash });
    const orphan = await repo.create({ ...base, kind: "send", params: { to: "0x1", amount: "1", token: "USDC" }, now: ago(6) });
    const fresh = await repo.create({ ...base, kind: "send", params: { to: "0x1", amount: "1", token: "USDC" }, now: ago(1) });

    expect(await reconcileUser({ db, kit, events, now: () => NOW }, "demo")).toBe(1);

    const byId = Object.fromEntries((await db.select().from(intents)).map((i) => [i.id, i]));
    expect(byId[pending.id]).toMatchObject({ status: "succeeded", actuals: { "You got": null } });
    expect(byId[orphan.id]).toMatchObject({ status: "executing", statusReason: "submission_unknown", error: { code: "UNKNOWN" } });
    expect(byId[orphan.id]!.error!.message).toMatch(/check your activity/i);
    expect(byId[fresh.id]!.status).toBe("executing");
    expect((await events.readAfter("s1", 0)).map((r) => r.island).filter((i) => i.kind === "receipt").map((i) => (i as { status: string }).status).sort()).toEqual(["succeeded"]);
  });

  it("leaves a still-pending swap executing", async () => {
    const { db, kit, events } = await testApp();
    const repo = new IntentRepo(db);
    kit.setPendingNext();
    const tx = await kit.swap(DEMO_WALLET, { tokenIn: "USDC", tokenOut: "EURC", amountIn: "1", slippageBps: 100 });
    const i = await repo.create({
      sessionId: "s1", userId: "demo", chain: "Arc_Testnet", kind: "swap", params: {}, preview: {},
      status: "executing", usdValue: "1", previewTurn: 0, now: ago(10), ttlSec: 120,
    });
    await repo.patch(i.id, { txHash: tx.txHash });
    expect(await reconcileUser({ db, kit, events, now: () => NOW }, "demo")).toBe(0);
    expect((await repo.get(i.id))!.status).toBe("executing");
  });
});

it("persists recovered receipts for later REST/SSE clients and activity (F11)", async () => {
  const { db, kit, events, call, app } = await testApp();
  const repo = new IntentRepo(db);
  const tx = await kit.swap(DEMO_WALLET, { tokenIn: "USDC", tokenOut: "EURC", amountIn: "1", slippageBps: 100 });
  const i = await repo.create({ sessionId: "s1", userId: "demo", chain: "Arc_Testnet", kind: "swap",
    params: { tokenOut: "EURC" }, preview: { estimated: { "You got": "0.92 EUR" } },
    status: "executing", usdValue: "1", previewTurn: 0, now: ago(2), ttlSec: 120 });
  await repo.patch(i.id, { txHash: tx.txHash });
  await reconcileUser({ db, kit, events, now: () => NOW }, "demo");
  const terminal = await (await call("GET", `/intents/${i.id}`)).json();
  expect(terminal.island).toMatchObject({ kind: "receipt", status: "succeeded", txHash: tx.txHash });
  const activity = await (await call("GET", "/activity")).json();
  expect(activity.items).toContainEqual(expect.objectContaining({ type: "intent.succeeded", intentId: i.id }));
  const response = await app.request("/events?sessionId=s1");
  const reader = response.body!.getReader();
  const chunk = await reader.read();
  await reader.cancel();
  expect(new TextDecoder().decode(chunk.value)).toContain('"kind":"receipt"');
});

it("leaves an unknown actual swap output null after recovery (F12)", async () => {
  const { db, kit, events } = await testApp();
  const repo = new IntentRepo(db);
  kit.setPendingNext();
  const tx = await kit.swap(DEMO_WALLET, { tokenIn: "USDC", tokenOut: "EURC", amountIn: "1", slippageBps: 100 });
  kit.settle(tx.txHash);
  const i = await repo.create({ sessionId: "s1", userId: "demo", chain: "Arc_Testnet", kind: "swap",
    params: { tokenOut: "EURC" }, preview: { estimated: { "You got": "0.92 EUR" } },
    status: "executing", usdValue: "1", previewTurn: 0, now: ago(2), ttlSec: 120 });
  await repo.patch(i.id, { txHash: tx.txHash });
  await reconcileUser({ db, kit, events, now: () => NOW }, "demo");
  expect((await repo.get(i.id))?.actuals).toEqual({ "You got": null });
});

async function executingSwap(ctx: Awaited<ReturnType<typeof testApp>>, over: { userId?: string; ageMin?: number; pending?: boolean } = {}) {
  const repo = new IntentRepo(ctx.db);
  if (over.pending) ctx.kit.setPendingNext();
  const tx = await ctx.kit.swap(DEMO_WALLET, { tokenIn: "USDC", tokenOut: "EURC", amountIn: "1", slippageBps: 100 });
  if (over.pending) ctx.kit.settle(tx.txHash);
  const i = await repo.create({ sessionId: "s1", userId: over.userId ?? "demo", chain: "Arc_Testnet", kind: "swap",
    params: { tokenOut: "EURC" }, preview: { estimated: { "You got": "0.92 EUR" } },
    status: "executing", usdValue: "1", previewTurn: 0, now: ago(over.ageMin ?? 2), ttlSec: 120 });
  await repo.patch(i.id, { txHash: tx.txHash });
  return { i, repo, txHash: tx.txHash };
}

describe("on-demand reconciliation", () => {
  it("reading an executing intent settles it", async () => {
    const t = await testApp();
    const { i, txHash } = await executingSwap(t, { pending: true });
    const body = await (await t.call("GET", `/intents/${i.id}`)).json();
    expect(body).toMatchObject({ status: "succeeded", island: { kind: "receipt", status: "succeeded", txHash } });
    const receipts = (await t.events.readAfter("s1", 0)).map((r) => r.island).filter((x) => x.kind === "receipt");
    expect(receipts).toHaveLength(1);
  });

  it("concurrent reads check once", async () => {
    const t = await testApp();
    const { i } = await executingSwap(t, { pending: true });
    const spy = vi.spyOn(t.kit, "waitForSwap");
    const rs = await Promise.all(Array.from({ length: 5 }, () => t.call("GET", `/intents/${i.id}`)));
    expect(rs.every((r) => r.status === 200)).toBe(true);
    expect(spy).toHaveBeenCalledTimes(1);
    const receipts = (await t.events.readAfter("s1", 0)).filter((r) => r.island.kind === "receipt");
    expect(receipts).toHaveLength(1);
  });

  it("does not recheck a still-pending intent within the 10 s window, but does after it", async () => {
    const t = await testApp();
    const { i, txHash, repo } = await executingSwap(t);
    const spy = vi.spyOn(t.kit, "waitForSwap").mockResolvedValue({ txHash, status: "PENDING" } as never);
    const deps = { db: t.db, kit: t.kit, events: t.events };
    expect(await reconcileIntent(deps, i.id)).toBe(false);
    expect(await reconcileIntent(deps, i.id)).toBe(false);
    expect(spy).toHaveBeenCalledTimes(1);
    await t.db.update(intents).set({ reconcileCheckedAt: new Date(Date.now() - 11_000).toISOString() });
    expect(await reconcileIntent(deps, i.id)).toBe(false);
    expect(spy).toHaveBeenCalledTimes(2);
    expect((await repo.get(i.id))!.status).toBe("executing");
  });

  it("another user's read is NOT_FOUND and triggers no network check", async () => {
    const t = await testApp();
    const { i } = await executingSwap(t);
    const spy = vi.spyOn(t.kit, "waitForSwap");
    const r = await t.call("GET", `/intents/${i.id}`, undefined, { "x-arcie-user": "mallory" });
    expect(r.status).toBe(404);
    expect(spy).not.toHaveBeenCalled();
    expect((await t.db.select().from(intents))[0]!.reconcileCheckedAt).toBeNull();
  });

  it("reading activity reconciles the caller's intents", async () => {
    const t = await testApp();
    const mine = await executingSwap(t, { pending: true });
    const spy = vi.spyOn(t.kit, "waitForSwap");
    const activity = await (await t.call("GET", "/activity")).json();
    expect(spy).toHaveBeenCalledTimes(1);
    expect((await mine.repo.get(mine.i.id))!.status).toBe("succeeded");
    expect(activity.items).toContainEqual(expect.objectContaining({ type: "intent.succeeded", intentId: mine.i.id }));
  });

  it("stops starting new checks once the budget is spent and caps each wait", async () => {
    const t = await testApp();
    await executingSwap(t);
    await executingSwap(t);
    const waits: number[] = [];
    vi.spyOn(t.kit, "waitForSwap").mockImplementation(async (_w, txHash, timeoutMs) => {
      waits.push(timeoutMs);
      await new Promise((r) => setTimeout(r, 60));
      return { txHash, status: "PENDING" } as never;
    });
    const started = Date.now();
    expect(await reconcileUser({ db: t.db, kit: t.kit, events: t.events }, "demo", 40)).toBe(0);
    expect(waits).toHaveLength(1); // the second check never starts: budget spent
    expect(waits[0]).toBeLessThanOrEqual(40);
    expect(Date.now() - started).toBeLessThan(500);
    const rows = await t.db.select().from(intents);
    expect(rows.filter((r) => r.reconcileCheckedAt !== null)).toHaveLength(1);
  });

  it("reconciliation never resubmits", async () => {
    const t = await testApp();
    const done = await executingSwap(t, { pending: true });
    const failedTx = await executingSwap(t, { pending: true });
    const pend = await executingSwap(t);
    vi.spyOn(t.kit, "waitForSwap").mockImplementation(async (_w, txHash) =>
      ({ txHash, status: txHash === pend.txHash ? "PENDING" : txHash === failedTx.txHash ? "FAILED" : "DONE" }) as never);
    const repo = new IntentRepo(t.db);
    const base = { sessionId: "s1", userId: "demo", chain: "Arc_Testnet" as const, kind: "send" as const, params: { to: "0x1", amount: "1", token: "USDC" },
      preview: {}, status: "executing" as const, usdValue: "1", previewTurn: 0, ttlSec: 120 };
    const orphan = await repo.create({ ...base, now: ago(60 * 24) });
    const sendTx = await repo.create({ ...base, now: ago(2) });
    await repo.patch(sendTx.id, { txHash: "0xabc" });
    t.kit.calls.length = 0;
    await reconcileUser({ db: t.db, kit: t.kit, events: t.events }, "demo");
    expect(t.kit.calls).toEqual([]); // no send/swap/deposit/withdraw/onramp, on any path
    const status = Object.fromEntries((await t.db.select().from(intents)).map((r) => [r.id, r.status]));
    expect(status[done.i.id]).toBe("succeeded");
    expect(status[failedTx.i.id]).toBe("failed");
    expect(status[pend.i.id]).toBe("executing");
    expect(status[sendTx.id]).toBe("executing");
    expect(status[orphan.id]).toBe("executing");
  });
});

describe("reconciliation versus a live confirm (R19)", () => {
  /** Holds the first waitForSwap open (the live confirm's) until release(); later calls resolve DONE immediately. */
  function latchWait(t: Awaited<ReturnType<typeof testApp>>) {
    let release!: () => void;
    let entered!: () => void;
    const started = new Promise<void>((r) => { entered = r; });
    const gate = new Promise<void>((r) => { release = r; });
    let calls = 0;
    t.kit.waitForSwap = async (_w, txHash) => {
      if (++calls === 1) { entered(); await gate; }
      return { txHash, status: "DONE" } as never;
    };
    return { started, release, calls: () => calls };
  }
  async function proposeSwap(t: Awaited<ReturnType<typeof testApp>>) {
    const p = await (await t.call("POST", "/intents", { kind: "swap", params: { tokenIn: "USDC", tokenOut: "EURC", amountIn: "6" } })).json();
    return p.island.intentId as string;
  }

  it("a read during a live confirm makes no network check; one terminal audit and the returned receipt is stored", async () => {
    const t = await testApp();
    const id = await proposeSwap(t);
    t.kit.setPendingNext();
    const gate = latchWait(t);
    const confirming = t.call("POST", `/intents/${id}/confirm`);
    await gate.started;

    const mid = await (await t.call("GET", `/intents/${id}`)).json();
    await t.call("GET", "/activity");
    expect(mid.status).toBe("executing");
    expect(gate.calls()).toBe(1); // only the live confirm's own wait
    expect((await t.db.select().from(intents))[0]!.reconcileCheckedAt).toBeNull();

    gate.release();
    const returned = await (await confirming).json();
    expect(returned.status).toBe("succeeded");
    const terminal = (await t.db.select().from(audit)).filter((a) => a.intentId === id && a.type === "intent.succeeded");
    expect(terminal).toHaveLength(1);
    const stored = await (await t.call("GET", `/intents/${id}`)).json();
    expect(stored.island).toEqual(JSON.parse(JSON.stringify(returned.island)));
  });

  it("the harness writes no terminal audit when its transition loses", async () => {
    const t = await testApp();
    const id = await proposeSwap(t);
    t.kit.setPendingNext();
    const gate = latchWait(t);
    const confirming = t.call("POST", `/intents/${id}/confirm`);
    await gate.started;
    // Another instance settles it after the live claim lapsed.
    await t.db.update(confirmClaims).set({ expiresAt: sql`now() - interval '1 second'` });
    const other = createDb(t.url, { max: 2 });
    try {
      await other.db.update(intents).set({ status: "succeeded" }).where(eq(intents.id, id));
    } finally {
      await other.close();
    }
    gate.release();
    await confirming;
    const rows = (await t.db.select().from(audit)).filter((a) => a.intentId === id);
    expect(rows.filter((a) => a.type === "intent.succeeded" || a.type === "intent.failed")).toHaveLength(0);
  });

  it("the route's check timeout is at most 3 s and every timeout stays under the 10 s dedup window", async () => {
    const t = await testApp();
    const { i } = await executingSwap(t);
    const waits: number[] = [];
    vi.spyOn(t.kit, "waitForSwap").mockImplementation(async (_w, h, timeoutMs) => { waits.push(timeoutMs); return { txHash: h, status: "PENDING" } as never; });
    await t.call("GET", `/intents/${i.id}`);
    expect(waits).toHaveLength(1);
    expect(waits[0]).toBeLessThanOrEqual(3_000);
    await t.db.update(intents).set({ reconcileCheckedAt: null });
    await reconcileIntent({ db: t.db, kit: t.kit, events: t.events }, i.id, 60_000);
    expect(waits).toHaveLength(2);
    expect(waits.every((w) => w < 10_000)).toBe(true);
  });
});

it.each(["PENDING", "FAILED", "DONE"] as const)("confirm returns the durable recovery receipt after a late %s result", async (late) => {
  const t = await testApp();
  const peer = createDb(t.url);
  const { island } = await (await t.call("POST", "/intents", { kind: "swap", params: { tokenIn: "USDC", tokenOut: "EURC", amountIn: "6" } })).json();
  const id = island.intentId;
  const entered = latch(), release = latch();
  t.kit.setPendingNext();
  const recoveryStatus = late === "DONE" ? "FAILED" : "DONE";
  let n = 0;
  t.kit.waitForSwap = async (_w, txHash) => {
    if (++n === 1) { entered.resolve(); await release.promise; return { txHash, status: late, explorerUrl: "fixture" }; }
    return { txHash, status: recoveryStatus, explorerUrl: "fixture" };
  };
  try {
    const confirming = t.call("POST", `/intents/${id}/confirm`);
    await entered.promise;
    await peer.db.update(confirmClaims).set({ expiresAt: sql`clock_timestamp() - interval '1 second'` }).where(eq(confirmClaims.intentId, id));
    expect(await reconcileIntent({ ...t, db: peer.db }, id)).toBe(true);
    release.resolve();
    const returned = await (await confirming).json();
    const stored = await (await t.call("GET", `/intents/${id}`)).json();
    expect(returned).toMatchObject({ status: stored.status, island: stored.island });
    const rows = (await peer.db.select().from(audit).where(eq(audit.intentId, id))).map((r) => r.type);
    expect(rows.filter((type) => /intent\.(succeeded|failed|pending|uncertain)/.test(type))).toEqual([`intent.${stored.status}`]);
    expect(t.kit.calls).toHaveLength(1);
  } finally { release.resolve(); await peer.close(); }
});

it.each(["send", "earn_deposit", "earn_withdraw"] as const)("requires receipt evidence to resolve %s, including a revert", async (kind) => {
  const t = await testApp();
  const repo = t.harness.intents;
  const base = { kind, sessionId: "s", userId: "demo", chain: "Arc_Testnet" as const, params: {}, preview: {}, status: "executing" as const, usdValue: "3", previewTurn: 0, now: ago(2), ttlSec: 120 };
  for (const status of ["PENDING", "FAILED", "DONE"] as const) {
    const row = await repo.create(base);
    await repo.patch(row.id, { txHash: "fixture-hash" });
    t.kit.readTransaction = async () => status;
    await reconcileIntent(t, row.id);
    expect((await repo.get(row.id))?.status).toBe(status === "PENDING" ? "executing" : status === "FAILED" ? "failed" : "succeeded");
  }
  expect(t.kit.calls).toHaveLength(0);
});

it("a hash committed after an orphan read wins over its stale uncertainty observation", async () => {
  const t = await testApp();
  const peer = createDb(t.url);
  const repo = t.harness.intents;
  const row = await repo.create({ kind: "send", sessionId: "s", userId: "demo", chain: "Arc_Testnet", params: {}, preview: {}, status: "executing", usdValue: "3", previewTurn: 0, now: ago(7), ttlSec: 120 });
  const original = IntentRepo.prototype.get;
  const spy = vi.spyOn(IntentRepo.prototype, "get").mockImplementationOnce(async function (this: IntentRepo, id) {
    const observed = await original.call(this, id);
    await new IntentRepo(peer.db).patch(id, { txHash: "fixture-late-hash" });
    return observed;
  });
  try {
    expect(await reconcileIntent({ ...t, now: () => NOW }, row.id)).toBe(false);
    expect(await repo.get(row.id)).toMatchObject({ txHash: "fixture-late-hash", status: "executing", statusReason: null });
    expect((await peer.db.select().from(audit).where(eq(audit.intentId, row.id)))).toHaveLength(0);
  } finally { spy.mockRestore(); await peer.close(); }
});

it("lets a reconnected web client discover a voice submission even when its activity read settles it", async () => {
  const t = await testApp();
  const { i } = await executingSwap(t, { pending: true });
  const activity = await (await t.call("GET", "/activity?executing=1")).json();
  expect(activity.executing).toEqual([i.id]);
  const result = await (await t.call("GET", `/intents/${i.id}`)).json();
  expect(result.island).toMatchObject({ kind: "receipt", intentId: i.id });
});
