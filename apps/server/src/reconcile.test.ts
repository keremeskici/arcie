import type { IslandPayload } from "@arcie/core";
import { intents } from "@arcie/db";
import { IntentRepo } from "@arcie/harness";
import { describe, expect, it } from "vitest";
import { reconcileExecuting } from "./reconcile.js";
import { DEMO_WALLET, testApp } from "./testkit.js";

const NOW = new Date("2026-11-07T12:00:00.000Z");
const ago = (min: number) => new Date(NOW.getTime() - min * 60_000);

describe("reconcileExecuting", () => {
  it("settles a pending swap, fails an orphan, and leaves a fresh one alone", async () => {
    const { db, kit, bus } = await testApp();
    const repo = new IntentRepo(db);
    const islands: IslandPayload[] = [];
    bus.subscribe("s1", (i) => islands.push(i));

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
    const pending = repo.create({ ...base, kind: "swap", params: { tokenIn: "USDC", tokenOut: "EURC", amountIn: "1", slippageBps: 100 }, now: ago(2) });
    repo.patch(pending.id, { txHash: tx.txHash });
    const orphan = repo.create({ ...base, kind: "send", params: { to: "0x1", amount: "1", token: "USDC" }, now: ago(6) });
    const fresh = repo.create({ ...base, kind: "send", params: { to: "0x1", amount: "1", token: "USDC" }, now: ago(1) });

    expect(await reconcileExecuting({ db, kit, bus, now: () => NOW })).toBe(2);

    const byId = Object.fromEntries(db.select().from(intents).all().map((i) => [i.id, i]));
    expect(byId[pending.id]).toMatchObject({ status: "succeeded", actuals: { "You got": null } });
    expect(byId[orphan.id]).toMatchObject({ status: "failed", error: { code: "UNKNOWN" } });
    expect(byId[orphan.id]!.error!.message).toMatch(/check your activity/i);
    expect(byId[fresh.id]!.status).toBe("executing");
    expect(islands.filter((i) => i.kind === "receipt").map((i) => (i as { status: string }).status).sort()).toEqual(["failed", "succeeded"]);
  });

  it("leaves a still-pending swap executing", async () => {
    const { db, kit, bus } = await testApp();
    const repo = new IntentRepo(db);
    kit.setPendingNext();
    const tx = await kit.swap(DEMO_WALLET, { tokenIn: "USDC", tokenOut: "EURC", amountIn: "1", slippageBps: 100 });
    const i = repo.create({
      sessionId: "s1", userId: "demo", chain: "Arc_Testnet", kind: "swap", params: {}, preview: {},
      status: "executing", usdValue: "1", previewTurn: 0, now: ago(10), ttlSec: 120,
    });
    repo.patch(i.id, { txHash: tx.txHash });
    expect(await reconcileExecuting({ db, kit, bus, now: () => NOW })).toBe(0);
    expect(repo.get(i.id)!.status).toBe("executing");
  });
});

it("persists recovered receipts for later REST/SSE clients and activity (F11)", async () => {
  const { db, kit, bus, call, app } = await testApp();
  const repo = new IntentRepo(db);
  const tx = await kit.swap(DEMO_WALLET, { tokenIn: "USDC", tokenOut: "EURC", amountIn: "1", slippageBps: 100 });
  const i = repo.create({ sessionId: "s1", userId: "demo", chain: "Arc_Testnet", kind: "swap",
    params: { tokenOut: "EURC" }, preview: { estimated: { "You got": "0.92 EUR" } },
    status: "executing", usdValue: "1", previewTurn: 0, now: ago(2), ttlSec: 120 });
  repo.patch(i.id, { txHash: tx.txHash });
  await reconcileExecuting({ db, kit, bus, now: () => NOW });
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
  const { db, kit, bus } = await testApp();
  const repo = new IntentRepo(db);
  kit.setPendingNext();
  const tx = await kit.swap(DEMO_WALLET, { tokenIn: "USDC", tokenOut: "EURC", amountIn: "1", slippageBps: 100 });
  kit.settle(tx.txHash);
  const i = repo.create({ sessionId: "s1", userId: "demo", chain: "Arc_Testnet", kind: "swap",
    params: { tokenOut: "EURC" }, preview: { estimated: { "You got": "0.92 EUR" } },
    status: "executing", usdValue: "1", previewTurn: 0, now: ago(2), ttlSec: 120 });
  repo.patch(i.id, { txHash: tx.txHash });
  await reconcileExecuting({ db, kit, bus, now: () => NOW });
  expect(repo.get(i.id)?.actuals).toEqual({ "You got": null });
});
