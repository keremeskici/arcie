import { FakeAppKit, type WalletRef } from "@arcie/appkit";
import type { ChoiceIsland, ConfirmIsland, IslandPayload, ReceiptIsland } from "@arcie/core";
import { intents, limits, seed, wallets } from "@arcie/db";
import { createTestDb } from "@arcie/db/testing";
import { DEFAULT_LIMITS } from "@arcie/core";
import { describe, expect, it, vi } from "vitest";
import type { HarnessCtx } from "./context.js";
import { EventLog } from "./events.js";
import { createHarness } from "./harness.js";
import { DbPolicyProvider } from "./policy/db-provider.js";

const SUFFIX = "Say confirm, or tap the card.";
const W: WalletRef = { chain: "Arc_Testnet", address: "0x000000000000000000000000000000000000dEaD", circleWalletId: "w1" };
const T0 = new Date("2026-11-07T10:00:00.000Z");

async function setup(opts: { confirmChannels?: "any" | "screen" } = {}) {
  const { db } = await createTestDb();
  await seed(db, { userId: "demo" });
  await db.insert(wallets).values({ id: "w1", userId: "demo", chain: "Arc_Testnet", circleWalletId: "w1", address: W.address, accountType: "EOA" });
  const kit = new FakeAppKit();
  kit.setBalance(W, "USDC", "100");
  kit.setBalance(W, "EURC", "20");
  const events = new EventLog(db);
  const islands = async (): Promise<IslandPayload[]> => (await events.readAfter("s1", 0, 1000)).map((r) => r.island);
  const h = createHarness({ db, kit, policy: new DbPolicyProvider(db), events, ...opts });
  let clock = new Date(T0);
  const ctx = (over: Partial<HarnessCtx> = {}): HarnessCtx => ({
    userId: "demo",
    sessionId: "s1",
    channel: "voice",
    userTurn: 1,
    now: () => clock,
    runId: "r1",
    ...over,
  });
  const advance = (sec: number) => (clock = new Date(clock.getTime() + sec * 1000));
  const allIntents = async () => db.select().from(intents);
  const balance = async (token: string) => (await kit.getBalances(W)).find((b) => b.token === token)?.amount;
  return { db, kit, islands, h, ctx, advance, allIntents, balance };
}

const confirmIsland = (r: { island?: IslandPayload }) => r.island as ConfirmIsland;

describe("propose → confirm → receipt", () => {
  it("proposes a send with a confirm island and a two-channel spoken prompt", async () => {
    const { h, ctx, islands } = await setup();
    const r = await h.runTool(ctx(), "propose_send", { to: "Bob", amount: "5", token: "USDC" });
    expect(r.summary.endsWith(SUFFIX)).toBe(true);
    expect(r.island?.kind).toBe("confirm");
    expect(confirmIsland(r).title).toBe("Send 5 USD to Bob?");
    expect((await islands()).some((i) => i.kind === "confirm")).toBe(true);
    await vi.waitFor(async () => expect((await islands()).some((i) => i.kind === "steps")).toBe(true));
  });

  it("refuses a voice confirm in the same turn, then executes on the next turn", async () => {
    const { h, ctx, balance, allIntents } = await setup();
    await h.runTool(ctx({ userTurn: 1 }), "propose_send", { to: "Bob", amount: "5", token: "USDC" });

    const same = await h.runTool(ctx({ userTurn: 1 }), "confirm_intent", {});
    expect(same.summary).toMatch(/say confirm after hearing the details/i);
    expect((await allIntents())[0]!.status).toBe("awaiting_confirmation");

    const next = await h.runTool(ctx({ userTurn: 2 }), "confirm_intent", {});
    const receipt = next.island as ReceiptIsland;
    expect(receipt.kind).toBe("receipt");
    expect(receipt.status).toBe("succeeded");
    expect(receipt.txHash).toMatch(/^0x/);
    expect((await allIntents())[0]!.status).toBe("succeeded");
    expect(await balance("USDC")).toBe("94.99");
  });

  it("never confirms a different intent when the LLM passes a made-up id (Review Focus 3)", async () => {
    const { h, ctx, allIntents } = await setup();
    await h.runTool(ctx(), "propose_send", { to: "Bob", amount: "5", token: "USDC" });
    const r = await h.runTool(ctx({ userTurn: 2 }), "confirm_intent", { id: "made-up" });
    expect(r.data).toMatchObject({ error: "NOT_FOUND" });
    expect((await allIntents())[0]!.status).toBe("awaiting_confirmation");
  });

  it("answers NOT_FOUND when nothing is waiting for confirmation", async () => {
    const { h, ctx } = await setup();
    const r = await h.runTool(ctx({ userTurn: 2 }), "confirm_intent", {});
    expect(r.data).toMatchObject({ error: "NOT_FOUND" });
  });

  it("executes exactly once when voice and screen confirm at the same time", async () => {
    const { h, ctx, kit } = await setup();
    const p = await h.runTool(ctx(), "propose_send", { to: "Bob", amount: "5", token: "USDC" });
    const id = confirmIsland(p).intentId;
    await Promise.all([h.confirm(ctx({ userTurn: 2 }), id, "voice"), h.confirm(ctx({ channel: "screen" }), id, "screen")]);
    expect(kit.calls.filter((c) => c.method === "send")).toHaveLength(1);
  });

  it("cancels the open intent and tells the screen to dismiss the card", async () => {
    const { h, ctx, allIntents, islands } = await setup();
    await h.runTool(ctx(), "propose_send", { to: "Bob", amount: "5", token: "USDC" });
    await h.runTool(ctx({ userTurn: 2 }), "cancel_intent", {});
    expect((await allIntents())[0]!.status).toBe("cancelled");
    expect(await islands()).toContainEqual(expect.objectContaining({ kind: "dismiss", reason: "cancelled" }));
  });

  it("supersedes the previous proposal so only one confirm card is open", async () => {
    const { h, ctx, allIntents } = await setup();
    await h.runTool(ctx(), "propose_send", { to: "Bob", amount: "5", token: "USDC" });
    await h.runTool(ctx({ userTurn: 2 }), "propose_send", { to: "Bob", amount: "6", token: "USDC" });
    expect((await allIntents()).map((i) => i.status).sort()).toEqual(["awaiting_confirmation", "cancelled"]);
  });
});

describe("recipients and amounts", () => {
  it("asks which Alice when the name is ambiguous (Review Focus 5)", async () => {
    const { h, ctx, allIntents } = await setup();
    const r = await h.runTool(ctx(), "propose_send", { to: "alice", amount: "5", token: "USDC" });
    const c = r.island as ChoiceIsland;
    expect(c.kind).toBe("choice");
    expect(c.options.map((o) => o.label).sort()).toEqual(["Alice", "Alice Smith"]);
    expect(r.summary).toBe("I found two contacts: Alice and Alice Smith. Which one?");
    expect(await allIntents()).toHaveLength(0);
  });

  it("records a tapped choice", async () => {
    const { h, ctx } = await setup();
    const r = await h.runTool(ctx(), "propose_send", { to: "alice", amount: "5", token: "USDC" });
    const c = r.island as ChoiceIsland;
    await expect(h.answerChoice(ctx({ channel: "screen" }), c.choiceId, c.options[0]!.id)).resolves.toBeUndefined();
    await expect(h.answerChoice(ctx({ channel: "screen" }), c.choiceId, "nope")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("refuses ENS names for now", async () => {
    const { h, ctx } = await setup();
    const r = await h.runTool(ctx(), "propose_send", { to: "alice.eth", amount: "5", token: "USDC" });
    expect(r.data).toMatchObject({ error: "INVALID_RECIPIENT" });
    expect(r.summary).toMatch(/ENS/);
  });

  it("refuses a malformed address", async () => {
    const { h, ctx } = await setup();
    const r = await h.runTool(ctx(), "propose_send", { to: "0x123", amount: "5", token: "USDC" });
    expect(r.data).toMatchObject({ error: "INVALID_RECIPIENT" });
  });

  it("requires a screen tap for a new raw-address recipient", async () => {
    const { h, ctx, allIntents } = await setup();
    const p = await h.runTool(ctx(), "propose_send", { to: "0x4444444444444444444444444444444444444444", amount: "5", token: "USDC" });
    expect(confirmIsland(p).risks).toContain("This is a new recipient.");
    const voice = await h.runTool(ctx({ userTurn: 2 }), "confirm_intent", {});
    expect(voice.summary).toMatch(/tap confirm on the card/i);
    expect((await allIntents())[0]!.status).toBe("awaiting_confirmation");
    const screen = await h.confirm(ctx({ channel: "screen" }), confirmIsland(p).intentId, "screen");
    expect(screen.status).toBe("succeeded");
  });

  it("rejects a non-numeric amount without creating an intent (Review Focus 1)", async () => {
    const { h, ctx, allIntents } = await setup();
    const r = await h.runTool(ctx(), "propose_send", { to: "Bob", amount: "five", token: "USDC" });
    expect(r.data).toMatchObject({ error: "INVALID_AMOUNT" });
    expect(await allIntents()).toHaveLength(0);
  });

  it("sends the whole USDC balance minus the network fee and says so (Review Focus 4)", async () => {
    const { h, ctx, balance, kit } = await setup();
    kit.setBalance(W, "USDC", "10");
    const p = await h.runTool(ctx(), "propose_send", { to: "Bob", amount: "all", token: "USDC" });
    const c = confirmIsland(p);
    expect(c.title).toBe("Send 9.99 USD to Bob?");
    expect(c.adjustments[0]).toContain("network fee");
    const r = await h.confirm(ctx({ channel: "screen" }), c.intentId, "screen");
    expect(r.status).toBe("succeeded");
    expect(await balance("USDC")).toBe("0");
  });
});

describe("policy", () => {
  it("rejects a send over the per-transaction limit and records it", async () => {
    const { h, ctx, allIntents } = await setup();
    const r = await h.runTool(ctx(), "propose_send", { to: "Bob", amount: "60", token: "USDC" });
    expect(r.summary).toContain("$50");
    expect((await allIntents())[0]!.status).toBe("rejected");
  });

  it("does not count withdrawals from your own vault against the limits", async () => {
    const { h, ctx, kit, db } = await setup();
    await db.update(limits).set({ json: { ...DEFAULT_LIMITS, maxPerTxUsd: 50 } });
    const vault = kit.vaults[0]!.address;
    for (const turn of [1, 3]) {
      const p = await h.runTool(ctx({ userTurn: turn }), "propose_earn_deposit", { vault, amount: "45" });
      await h.confirm(ctx({ channel: "screen" }), confirmIsland(p).intentId, "screen");
    }
    const w = await h.runTool(ctx({ userTurn: 5 }), "propose_earn_withdraw", { vault, amount: "all" });
    expect(confirmIsland(w).title).toMatch(/Withdraw 90 USD\b/);
  });
});

describe("swaps and earn", () => {
  it("re-quotes a stale swap and asks again when the price moved past the slippage cap", async () => {
    const { h, ctx, kit, advance } = await setup();
    const p = await h.runTool(ctx(), "propose_swap", { tokenIn: "USDC", tokenOut: "EURC", amountIn: "10" });
    advance(31);
    kit.setSwapRate("USDC", "EURC", 0.92 * 0.98);
    const r = await h.confirm(ctx({ channel: "screen" }), confirmIsland(p).intentId, "screen");
    expect(r.status).toBe("awaiting_confirmation");
    expect(confirmIsland(r).adjustments).toContain("The price moved; here's the updated quote.");
    expect(kit.calls.filter((c) => c.method === "swap")).toHaveLength(0);
  });

  it("executes a fresh swap and suggests earning on the output", async () => {
    const { h, ctx } = await setup();
    const p = await h.runTool(ctx(), "propose_swap", { tokenIn: "USDC", tokenOut: "EURC", amountIn: "10" });
    const r = await h.confirm(ctx({ channel: "screen" }), confirmIsland(p).intentId, "screen");
    const receipt = r.island as ReceiptIsland;
    expect(receipt.rows).toContainEqual({ label: "You got", estimated: "9.2 EUR", actual: "9.2 EUR" });
    expect(receipt.nextStep).toEqual({ label: "Earn on it", utterance: "put my EUR somewhere it earns" });
  });

  it("picks the highest-APY vault for 'best'", async () => {
    const { h, ctx, kit } = await setup();
    const p = await h.runTool(ctx(), "propose_earn_deposit", { vault: "best", amount: "10" });
    await h.confirm(ctx({ channel: "screen" }), confirmIsland(p).intentId, "screen");
    expect(kit.calls.find((c) => c.method === "deposit")?.params).toMatchObject({ vault: "0x00000000000000000000000000000000000000a2" });
  });
});

describe("read tools", () => {
  it("quotes a swap without creating an intent", async () => {
    const { h, ctx, allIntents } = await setup();
    const r = await h.runTool(ctx(), "get_swap_quote", { tokenIn: "USDC", tokenOut: "EURC", amountIn: "10" });
    expect(r.data).toMatchObject({ estimatedOut: "9.2" });
    expect(await allIntents()).toHaveLength(0);
  });

  it("returns every token balance", async () => {
    const { h, ctx } = await setup();
    const r = await h.runTool(ctx(), "get_balances", {});
    expect((r.data as { balances: { token: string }[] }).balances.map((b) => b.token)).toEqual(["USDC", "EURC", "cirBTC"]);
    expect(r.summary).toBe("You have 100 USD and 20 EUR.");
  });

  it("lists earn positions before and after a deposit", async () => {
    const { h, ctx } = await setup();
    expect((await h.runTool(ctx(), "get_earn_positions", {})).data).toEqual({ positions: [] });
    const p = await h.runTool(ctx(), "propose_earn_deposit", { vault: "best", amount: "10" });
    await h.confirm(ctx({ channel: "screen" }), confirmIsland(p).intentId, "screen");
    expect(((await h.runTool(ctx(), "get_earn_positions", {})).data as { positions: unknown[] }).positions).toHaveLength(1);
  });

  it("lists a succeeded send in activity", async () => {
    const { h, ctx } = await setup();
    const p = await h.runTool(ctx(), "propose_send", { to: "Bob", amount: "5", token: "USDC" });
    await h.confirm(ctx({ channel: "screen" }), confirmIsland(p).intentId, "screen");
    const r = await h.runTool(ctx(), "get_activity", {});
    expect(r.data).toMatchObject({ items: [{ kind: "send", status: "succeeded" }] });
  });
});

describe("confirmation channel policy", () => {
  it("with 'screen', a voice confirm waits for a tap and a screen confirm executes", async () => {
    const { h, ctx, allIntents } = await setup({ confirmChannels: "screen" });
    const p = await h.runTool(ctx(), "propose_send", { to: "Bob", amount: "5", token: "USDC" });
    const v = await h.runTool(ctx({ userTurn: 2 }), "confirm_intent", {});
    expect(v.summary).toBe("Tap confirm on the card to finish.");
    expect((await allIntents())[0]!.status).toBe("awaiting_confirmation");
    expect((await h.confirm(ctx({ channel: "screen" }), confirmIsland(p).intentId, "screen")).status).toBe("succeeded");
  });
});

describe("session-bound confirmation (F4)", () => {
  it("rejects another session's explicit confirm id without moving money", async () => {
    const { h, ctx, kit } = await setup();
    const a = confirmIsland(await h.runTool(ctx(), "propose_send", { to: "Bob", amount: "5" }));
    const b = confirmIsland(await h.runTool(ctx({ sessionId: "s2" }), "propose_send", { to: "Bob", amount: "6" }));
    const result = await h.runTool(ctx({ sessionId: "s2", userTurn: 2 }), "confirm_intent", { id: a.intentId });
    expect(result.data).toMatchObject({ error: "NOT_FOUND" });
    expect((await h.intents.get(a.intentId))?.status).toBe("awaiting_confirmation");
    expect((await h.intents.get(b.intentId))?.status).toBe("awaiting_confirmation");
    expect(kit.calls).toHaveLength(0);
  });

  it("rejects another session's explicit cancellation", async () => {
    const { h, ctx } = await setup();
    const a = confirmIsland(await h.runTool(ctx(), "propose_send", { to: "Bob", amount: "5" }));
    const result = await h.runTool(ctx({ sessionId: "s2" }), "cancel_intent", { id: a.intentId });
    expect(result.data).toMatchObject({ error: "NOT_FOUND" });
    expect((await h.intents.get(a.intentId))?.status).toBe("awaiting_confirmation");
  });
});

describe("spending claims at confirmation (F1)", () => {
  it.each([false, true])("enforces the daily cap across previously prepared sessions (concurrent=%s)", async (concurrent) => {
    const { h, ctx, db, kit, balance } = await setup();
    await db.update(limits).set({ json: { ...DEFAULT_LIMITS, dailyCapUsd: 10 } });
    const a = confirmIsland(await h.runTool(ctx(), "propose_send", { to: "Bob", amount: "6" }));
    const bctx = ctx({ sessionId: "s2", userTurn: 2 });
    const b = confirmIsland(await h.runTool(bctx, "propose_send", { to: "Bob", amount: "6" }));
    const confirm = (c: HarnessCtx, id: string) => h.runTool({ ...c, channel: "screen" }, "confirm_intent", { id });
    const results = concurrent
      ? await Promise.all([confirm(ctx(), a.intentId), confirm(bctx, b.intentId)])
      : [await confirm(ctx(), a.intentId), await confirm(bctx, b.intentId)];
    expect(results.filter((r) => (r.data as { status?: string }).status === "succeeded")).toHaveLength(1);
    expect(results.some((r) => (r.data as { error?: string }).error === "POLICY_DENIED")).toBe(true);
    expect(kit.calls.filter((c) => c.method === "send")).toHaveLength(1);
    expect(await balance("USDC")).toBe("93.99");
  });

  it("reserves the cap for a submitted but unsettled transaction", async () => {
    const { h, ctx, db, kit } = await setup();
    await db.update(limits).set({ json: { ...DEFAULT_LIMITS, dailyCapUsd: 10 } });
    const a = confirmIsland(await h.runTool(ctx(), "propose_swap", { tokenIn: "USDC", tokenOut: "EURC", amountIn: "6" }));
    const bctx = ctx({ sessionId: "s2", channel: "screen" });
    const b = confirmIsland(await h.runTool(bctx, "propose_send", { to: "Bob", amount: "6" }));
    kit.setPendingNext();
    expect((await h.confirm(ctx({ channel: "screen" }), a.intentId, "screen")).status).toBe("executing");
    const result = await h.runTool(bctx, "confirm_intent", { id: b.intentId });
    expect(result.data).toMatchObject({ error: "POLICY_DENIED" });
    expect(kit.calls.filter((c) => c.method === "send")).toHaveLength(0);
  });

  it("applies limits tightened after the preview", async () => {
    const { h, ctx, db, kit } = await setup();
    const a = confirmIsland(await h.runTool(ctx(), "propose_send", { to: "Bob", amount: "6" }));
    await db.update(limits).set({ json: { ...DEFAULT_LIMITS, maxPerTxUsd: 5 } });
    const result = await h.runTool(ctx({ userTurn: 2 }), "confirm_intent", { id: a.intentId });
    expect(result.data).toMatchObject({ error: "POLICY_DENIED" });
    expect(kit.calls).toHaveLength(0);
  });
});

describe("approved swap floor (F2)", () => {
  it("does not execute below the displayed minimum even before the quote is stale", async () => {
    const { h, ctx, kit, balance } = await setup();
    const a = confirmIsland(await h.runTool(ctx(), "propose_swap", { tokenIn: "USDC", tokenOut: "EURC", amountIn: "10" }));
    kit.setSwapRate("USDC", "EURC", 0.7);
    const result = await h.confirm(ctx({ channel: "screen" }), a.intentId, "screen");
    expect(result.status).toBe("failed");
    expect((result.island as ReceiptIsland).error?.code).toBe("SLIPPAGE_EXCEEDED");
    expect(await balance("USDC")).toBe("100");
    expect((await h.intents.get(a.intentId))?.params).toMatchObject({ minOut: "9.108" });
  });
});

describe("overlapping quote confirmations (F5)", () => {
  it("requires a fresh confirmation after a delayed replacement quote", async () => {
    const { h, ctx, kit, advance, islands } = await setup();
    const a = confirmIsland(await h.runTool(ctx(), "propose_swap", { tokenIn: "USDC", tokenOut: "EURC", amountIn: "10" }));
    advance(31);
    let release!: (quote: Awaited<ReturnType<typeof kit.estimateSwap>>) => void;
    let entered!: () => void;
    const started = new Promise<void>((r) => { entered = r; });
    const gate = new Promise<Awaited<ReturnType<typeof kit.estimateSwap>>>((r) => { release = r; });
    const original = kit.estimateSwap.bind(kit);
    let n = 0;
    kit.estimateSwap = async (w, p) => { if (++n === 1) { entered(); return gate; } return original(w, p); };
    const first = h.confirm(ctx({ channel: "screen" }), a.intentId, "screen");
    await started;
    const second = await h.confirm(ctx({ channel: "screen" }), a.intentId, "screen");
    release({ estimatedOut: "8", minOut: "7.92", fees: [] });
    const result = await first;
    expect(result.status).toBe("awaiting_confirmation");
    expect(second.status).not.toBe("succeeded");
    expect(kit.calls.filter((c) => c.method === "swap")).toHaveLength(0);
    expect((await islands()).filter((i) => i.kind === "confirm")).toHaveLength(2);
  });

  it("does not republish a quote cancelled during its refresh", async () => {
    const { h, ctx, kit, advance, islands } = await setup();
    const a = confirmIsland(await h.runTool(ctx(), "propose_swap", { tokenIn: "USDC", tokenOut: "EURC", amountIn: "10" }));
    advance(31);
    let release!: () => void;
    let entered!: () => void;
    const started = new Promise<void>((r) => { entered = r; });
    const gate = new Promise<void>((r) => { release = r; });
    kit.estimateSwap = async () => { entered(); await gate; return { estimatedOut: "8", minOut: "7.92", fees: [] }; };
    const pending = h.runTool(ctx({ channel: "screen" }), "confirm_intent", { id: a.intentId });
    await started;
    await h.cancel(ctx(), a.intentId);
    release();
    await pending;
    expect((await h.intents.get(a.intentId))?.status).toBe("cancelled");
    expect((await islands()).filter((i) => i.kind === "confirm")).toHaveLength(1);
    expect(kit.calls).toHaveLength(0);
  });
});

describe("submitted transaction recovery (F3)", () => {
  it("persists the submitted hash before polling and keeps a timeout pending", async () => {
    const { h, ctx, kit, balance } = await setup();
    const a = confirmIsland(await h.runTool(ctx(), "propose_swap", { tokenIn: "USDC", tokenOut: "EURC", amountIn: "6" }));
    kit.setPendingNext();
    let savedDuringPoll: Awaited<ReturnType<typeof h.intents.get>>;
    kit.waitForSwap = async (_w, txHash) => {
      savedDuringPoll = await h.intents.get(a.intentId);
      throw new Error(`Polling timed out for ${txHash}`);
    };
    const result = await h.confirm(ctx({ channel: "screen" }), a.intentId, "screen");
    expect(savedDuringPoll!).toMatchObject({ status: "executing", txHash: expect.stringMatching(/^0x/) });
    expect(result.status).toBe("executing");
    expect(result.island).toBeUndefined();
    expect(await h.intents.get(a.intentId)).toMatchObject({ status: "executing", txHash: savedDuringPoll!.txHash });
    expect(await balance("USDC")).toBe("93.99");
    const retry = await h.runTool(ctx({ userTurn: 2 }), "confirm_intent", { id: a.intentId });
    expect(retry.data).toMatchObject({ error: "NOT_FOUND" });
    expect(kit.calls.filter((c) => c.method === "swap")).toHaveLength(1);
  });

  it("keeps an uncertain submission reserved instead of inviting a retry", async () => {
    const { h, ctx, kit, db } = await setup();
    await db.update(limits).set({ json: { ...DEFAULT_LIMITS, dailyCapUsd: 10 } });
    const a = confirmIsland(await h.runTool(ctx(), "propose_send", { to: "Bob", amount: "6" }));
    kit.failNext("RPC_UNAVAILABLE");
    const result = await h.confirm(ctx({ channel: "screen" }), a.intentId, "screen");
    expect(result.status).toBe("executing");
    expect(result.summary).toMatch(/check.*activity/i);
    expect((await h.intents.get(a.intentId))?.statusReason).toBe("submission_unknown");
    const next = await h.runTool(ctx({ sessionId: "s2" }), "propose_send", { to: "Bob", amount: "6" });
    expect(next.data).toMatchObject({ error: "POLICY_DENIED" });
  });
});

describe("interrupted preparations (F6)", () => {
  it.each(["cancel", "abort", "newer"])("does not publish an old delayed proposal after %s", async (event) => {
    const { h, ctx, kit, islands, allIntents } = await setup();
    let release!: () => void;
    let entered!: () => void;
    const started = new Promise<void>((r) => { entered = r; });
    const gate = new Promise<void>((r) => { release = r; });
    const original = kit.estimateSend.bind(kit);
    let n = 0;
    kit.estimateSend = async (w, p) => { if (++n === 1) { entered(); await gate; } return original(w, p); };
    const ac = new AbortController();
    const oldCtx = { ...ctx(), signal: ac.signal };
    const pending = h.runTool(oldCtx, "propose_send", { to: "Bob", amount: "5" });
    await started;
    if (event === "cancel") await h.cancel(ctx());
    if (event === "abort") ac.abort();
    if (event === "newer") await h.runTool(ctx({ userTurn: 2 }), "propose_send", { to: "Bob", amount: "6" });
    release();
    await pending;
    expect((await allIntents()).some((i) => i.params.amount === "5")).toBe(false);
    expect((await islands()).filter((i) => i.kind === "confirm")).toHaveLength(event === "newer" ? 1 : 0);
    if (event === "newer") expect((await allIntents())[0]?.status).toBe("awaiting_confirmation");
  });
});

describe("swap asset policy (F9)", () => {
  it("refuses to acquire a forbidden output token", async () => {
    const { h, ctx, db } = await setup();
    await db.update(limits).set({ json: { ...DEFAULT_LIMITS, allowedTokens: ["USDC"] } });
    const result = await h.runTool(ctx(), "propose_swap", { tokenIn: "USDC", tokenOut: "cirBTC", amountIn: "5" });
    expect(result.data).toMatchObject({ error: "POLICY_DENIED" });
    expect(result.island).toBeUndefined();
  });

  it("checks the output allowlist again when confirming", async () => {
    const { h, ctx, db, kit } = await setup();
    const a = confirmIsland(await h.runTool(ctx(), "propose_swap", { tokenIn: "USDC", tokenOut: "EURC", amountIn: "5" }));
    await db.update(limits).set({ json: { ...DEFAULT_LIMITS, allowedTokens: ["USDC"] } });
    const result = await h.runTool(ctx({ userTurn: 2 }), "confirm_intent", { id: a.intentId });
    expect(result.data).toMatchObject({ error: "POLICY_DENIED" });
    expect(kit.calls).toHaveLength(0);
  });
});

describe("raw recipient checksums (F10)", () => {
  it.each([
    "0x000000000000000000000000000000000000dead",
    "0x000000000000000000000000000000000000dEad",
  ])("does not silently repair the raw address %s", async (to) => {
    const { h, ctx, allIntents } = await setup();
    const result = await h.runTool(ctx(), "propose_send", { to, amount: "5" });
    expect(result.data).toMatchObject({ error: "INVALID_RECIPIENT" });
    expect(await allIntents()).toHaveLength(0);
  });
  it("accepts a raw address with its exact checksum", async () => {
    const { h, ctx } = await setup();
    const result = await h.runTool(ctx(), "propose_send", { to: "0x000000000000000000000000000000000000dEaD", amount: "5" });
    expect(result.island?.kind).toBe("confirm");
  });
});

describe("withdrawal gas availability (F15)", () => {
  it.each(["USDC", "EURC"] as const)("checks wallet USDC gas independently of the %s vault position", async (token) => {
    const { h, ctx, kit } = await setup();
    const vault = kit.vaults.find((v) => v.token === token)!.address;
    const a = confirmIsland(await h.runTool(ctx(), "propose_earn_deposit", { vault, amount: "5", token }));
    await h.confirm(ctx({ channel: "screen" }), a.intentId, "screen");
    kit.setBalance(W, "USDC", "0");
    const result = await h.runTool(ctx(), "propose_earn_withdraw", { vault, amount: "all" });
    expect(result.data).toMatchObject({ error: "INSUFFICIENT_BALANCE" });
    expect(result.summary).toMatch(/network fee/i);
    expect(result.island).toBeUndefined();
  });

  it("allows a full withdrawal with only enough wallet balance for gas even after limits are lowered", async () => {
    const { h, ctx, kit, db } = await setup();
    const vault = kit.vaults[0]!.address;
    const a = confirmIsland(await h.runTool(ctx(), "propose_earn_deposit", { vault, amount: "5" }));
    await h.confirm(ctx({ channel: "screen" }), a.intentId, "screen");
    await db.update(limits).set({ json: { ...DEFAULT_LIMITS, dailyCapUsd: 0, maxPerTxUsd: 0 } });
    kit.setBalance(W, "USDC", "0.01");
    const result = await h.runTool(ctx(), "propose_earn_withdraw", { vault, amount: "all" });
    expect(result.island?.kind).toBe("confirm");
    expect((await h.confirm(ctx({ channel: "screen" }), confirmIsland(result).intentId, "screen")).status).toBe("succeeded");
  });
});
