import { randomUUID } from "node:crypto";
import { ArcieError, type IslandPayload } from "@arcie/core";
import { audit, limits } from "@arcie/db";
import { eq } from "drizzle-orm";
import { expect, it } from "vitest";
import { testApp } from "../testkit.js";

const pair = { tokenIn: "USDC", tokenOut: "EURC", amountIn: "5" };
const headers = { "x-arcie-session": "swap-screen" };

async function setup() {
  const app = await testApp();
  const events: IslandPayload[] = [];
  app.bus.subscribe(headers["x-arcie-session"], e => events.push(e));
  const quote = await (await app.call("POST", "/quotes/swap", pair, headers)).json();
  const trade = { ...pair, minOut: quote.data.minOut as string, requestId: randomUUID() };
  return { ...app, events, trade, submit: (body = trade) => app.call("POST", "/swaps", body, headers) };
}

it("streams no wallet events and writes no audit records while the screen polls prices", async () => {
  const { events, db, call } = await setup();
  await call("POST", "/quotes/swap", pair, headers);
  expect(events).toEqual([]);
  expect(db.select().from(audit).all()).toHaveLength(0);
});

it("submits once at the approved minimum and returns the actual receipt on replay", async () => {
  const { submit, trade, kit, events, harness } = await setup();
  kit.setSwapRate("USDC", "EURC", 0.919);
  const both = await Promise.all([submit(), submit()]);
  for (const res of both) expect(res.status).toBe(200);
  const receipt = await (await submit()).json();
  expect(receipt).toMatchObject({ intentId: trade.requestId, status: "succeeded", island: { kind: "receipt", status: "succeeded" } });
  expect(kit.calls).toHaveLength(1);
  expect(kit.calls[0]).toMatchObject({ method: "swap", params: { minOut: trade.minOut, slippageBps: 100 } });
  expect(events.map(event => event.kind)).toEqual(["receipt"]);
  expect(harness.intents.get(trade.requestId)).toMatchObject({ confirmedVia: "screen", status: "succeeded" });
  expect((await submit({ ...trade, amountIn: "7" })).ok).toBe(false);
  expect(kit.calls).toHaveLength(1);
});

it("requires another tap for a worse price and never executes the old request on retry", async () => {
  const { kit, events, submit, trade } = await setup();
  kit.setSwapRate("USDC", "EURC", 0.85);
  expect(await (await submit()).json()).toMatchObject({ intentId: trade.requestId, status: "requote" });
  kit.setSwapRate("USDC", "EURC", 1.2);
  expect(await (await submit()).json()).toMatchObject({ status: "requote" });
  expect(kit.calls).toEqual([]);
  expect(events).toEqual([]);
});

it("checks spending limits and rejects client trade settings", async () => {
  const { db, submit, call, trade, kit } = await setup();
  const config = db.select().from(limits).where(eq(limits.userId, "demo")).get()!;
  db.update(limits).set({ json: { ...config.json, dailyCapUsd: 6 } }).where(eq(limits.userId, "demo")).run();
  expect((await call("POST", "/swaps", { ...trade, maxSlippageBps: 10000 }, headers)).status).toBe(400);
  const results = await Promise.all([submit(), submit({ ...trade, requestId: randomUUID() })]);
  expect(results.map(r => r.status).sort()).toEqual([200,400]);
  expect(kit.calls).toHaveLength(1);
});

it("retains an ambiguous submission and never resubmits it", async () => {
  const { kit, submit, trade, call } = await setup();
  let attempts = 0;
  kit.swap = async () => { attempts++; throw new ArcieError("RPC_UNAVAILABLE"); };
  expect(await (await submit()).json()).toMatchObject({ status: "executing", intentId: trade.requestId });
  expect(await (await submit()).json()).toMatchObject({ status: "executing" });
  expect(await (await call("GET", "/intents/" + trade.requestId, undefined, headers)).json()).toMatchObject({ status: "executing", statusReason: "submission_unknown" });
  expect(attempts).toBe(1);
});

it.each([[500, 100], [25, 25]])("uses default price protection within the account limit of %d bps", async (cap, expected) => {
  const { db, call, trade, kit } = await setup();
  const account = db.select().from(limits).where(eq(limits.userId, "demo")).get()!;
  db.update(limits).set({ json: { ...account.json, maxSlippageBps: cap } }).where(eq(limits.userId, "demo")).run();
  const quote = await (await call("POST", "/quotes/swap", pair, headers)).json();
  expect(quote.data.slippageBps).toBe(expected);
  const result = await (await call("POST", "/swaps", { ...trade, minOut: quote.data.minOut }, headers)).json();
  expect(result.status).toBe("succeeded");
  expect(kit.calls[0]?.params).toMatchObject({ slippageBps: expected });
});

it("reconciles a pending screen swap and replays its receipt only to the same account", async () => {
  const { call, trade, submit, kit, harness } = await setup();
  kit.setPendingNext();
  expect(await (await submit()).json()).toMatchObject({ status: "executing" });
  const hash = harness.intents.get(trade.requestId)!.txHash!;
  kit.settle(hash, "DONE");
  expect(await (await call("GET", "/intents/" + trade.requestId, undefined, headers)).json()).toMatchObject({ status: "succeeded", island: { txHash: hash } });
  expect(await (await call("POST", "/swaps", trade, { "x-arcie-session": "renewed" })).json()).toMatchObject({ status: "succeeded", island: { txHash: hash } });
  const stranger = await call("POST", "/swaps", trade, { "x-arcie-user": "another-user" });
  expect(stranger.ok).toBe(false);
  expect(await stranger.text()).not.toContain(hash);
  expect(kit.calls).toHaveLength(1);
});

it("holds a stricter platform floor and returns an execution failure on a late price drop", async () => {
  const { submit, kit, trade } = await setup();
  const original = kit.swap.bind(kit);
  kit.swap = (wallet, params) => { kit.setSwapRate("USDC", "EURC", 0.1); return original(wallet, params); };
  const smallerFloor = { ...trade, minOut: "0.000001" };
  const result = await (await submit(smallerFloor)).json();
  expect(result).toMatchObject({ status: "failed", island: { kind: "receipt", error: { code: "SLIPPAGE_EXCEEDED" } } });
  expect(kit.calls[0]?.params).toMatchObject({ minOut: trade.minOut });
  expect(await (await submit(smallerFloor)).json()).toMatchObject({ status: "failed" });
  expect(kit.calls).toHaveLength(1);
});
