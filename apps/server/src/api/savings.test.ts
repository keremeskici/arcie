import { expect, it } from "vitest";
import { DEMO_WALLET, testApp } from "../testkit.js";

const fixed = "0xaabbef1d3971c710276ed41ec791bbe14cdb8e88";
const headers = { "x-arcie-session": "savings-test" };
const ctx = { sessionId: "savings-test", userId: "demo", channel: "voice" as const, userTurn: 1, now: () => new Date(), runId: "read" };

it("uses the same USD savings position for the rate, default deposit, saved review, receipt and full withdrawal", async () => {
  const { call, kit, harness } = await testApp();
  expect(await (await call("GET", "/savings")).json()).toEqual({ available: true, annualRate: 0.042, balance: "0", earned: "0" });
  const p = await (await call("POST", "/intents", { kind: "earn_deposit", params: { amount: "5" } }, headers)).json();
  expect(p.island).toMatchObject({ title: "Add 5 USD to savings?", action: "earn_deposit" });
  expect(p.island.risks.join(" ")).toMatch(/rate.*change/i);
  expect(p.island.rows).toContainEqual(expect.objectContaining({ label: "Network fee" }));
  expect(p.island.rows).toContainEqual(expect.objectContaining({ label: "Annual rate", value: "4.2%" }));
  const id = p.island.intentId;
  expect((await harness.intents.get(id))?.params.vault).toBe(fixed);
  const recovered = await (await call("GET", `/intents/${id}`, undefined, headers)).json();
  expect(recovered.island).toEqual(p.island);
  const receipt = await (await call("POST", `/intents/${id}/confirm`, {}, headers)).json();
  expect(receipt.island.rows).toContainEqual({ label: "Added to savings", actual: "5 USD", estimated: "5 USD" });
  const result = await (await call("GET", "/savings")).json();
  expect(result).toMatchObject({ balance: "5", earned: "0" });
  for (const read of ["get_earn_positions", "list_earn_vaults", "get_activity"]) {
    const tool = await harness.runTool(ctx, read, {});
    expect(JSON.stringify(tool)).not.toMatch(/EarnKit|Fake |vault|APY|0xaabbef/i);
  }
  const w = await (await call("POST", "/intents", { kind: "earn_withdraw", params: { vault: "savings", amount: "all" } }, headers)).json();
  expect(w.island).toMatchObject({ title: "Withdraw 5 USD from savings?", action: "earn_withdraw" });
  await call("POST", `/intents/${w.island.intentId}/confirm`, {}, headers);
  expect(kit.calls).toEqual([{ method: "deposit", params: { vault: fixed, amount: "5" } }, { method: "withdraw", params: { vault: fixed, amount: "5" } }]);
  expect(JSON.stringify([p, receipt, recovered, w])).not.toMatch(/EarnKit|Fake |vault|APY|0xaabbef/i);
});

it("keeps unrelated positions accessible by explicit address without counting them in savings", async () => {
  const { kit, call } = await testApp();
  const other = kit.vaults.find(v => v.address.toLowerCase() !== fixed && v.apy > 0.042)!;
  await kit.deposit(DEMO_WALLET, { vault: other.address, amount: "3" });
  const before = await (await call("GET", "/vaults")).json();
  expect(before.positions).toContainEqual(expect.objectContaining({ vault: other.address, currentBalance: "3" }));
  expect(await (await call("GET", "/savings")).json()).toMatchObject({ balance: "0" });
  const r = await (await call("POST", "/intents", { kind: "earn_withdraw", params: { vault: other.address, amount: "all" } }, headers)).json();
  expect(r.island.title).toContain(other.name);
  const done = await (await call("POST", `/intents/${r.island.intentId}/confirm`, {}, headers)).json();
  expect(done.status).toBe("succeeded");
});

it("never substitutes another provider when savings is unavailable or another currency is requested", async () => {
  const { kit, call, harness } = await testApp();
  const eur = await call("POST", "/intents", { kind: "earn_deposit", params: { vault: "savings", token: "EURC", amount: "1" } }, headers);
  expect(eur.status).toBe(400);
  expect((await eur.json()).error.message).toContain("USD");
  kit.vaults.splice(0, kit.vaults.length, ...kit.vaults.filter(v => v.address.toLowerCase() !== fixed));
  expect(await (await call("GET", "/savings")).json()).toEqual({ available: false, annualRate: null, balance: null, earned: null });
  for (const read of ["list_earn_vaults", "get_earn_positions"]) {
    const r = await harness.runTool(ctx, read, {});
    expect(r.summary).toMatch(/savings.*unavailable/i);
    expect(r.data).toMatchObject({ available: false });
  }
  const missing = await call("POST", "/intents", { kind: "earn_deposit", params: { vault: "savings", amount: "1" } }, headers);
  expect(missing.status).toBe(400);
  expect((await missing.json()).error.message).toMatch(/savings.*unavailable/i);
  expect(kit.calls).toEqual([]);
});

it("keeps original terms on a recovered fixed-product review while leaving unrelated reviews untouched", async () => {
  const { call, harness, kit } = await testApp();
  const original = await (await call("POST", "/intents", { kind: "earn_deposit", params: { amount: "5" } }, headers)).json();
  const id = original.island.intentId;
  const { buildEarnConfirm } = await import("../../../../packages/harness/src/disclosure/earn.js");
  const legacy = buildEarnConfirm({ intentId: id, direction: "deposit", vaultName: "Former Provider", token: "USDC", amount: "5", apy: .017,
    fees: [{ label: "Vault fee", token: "USDC", amount: ".2" }], adjustments: ["Original adjustment."], expiresAt: original.island.expiresAt });
  await harness.intents.patch(id, { preview: { island: legacy } });
  const rebound = (await (await call("GET", `/intents/${id}`, undefined, headers)).json()).island;
  expect(rebound).toMatchObject({ title: "Add 5 USD to savings?", action: "earn_deposit", expiresAt: legacy.expiresAt, adjustments: legacy.adjustments });
  expect(rebound.rows).toContainEqual({ label: "Annual rate", value: "1.7%", estimate: true });
  expect(rebound.rows).toContainEqual({ label: "Service fee", value: "0.2 USD", estimate: true });
  expect(JSON.stringify(rebound)).not.toMatch(/Former Provider|vault|APY/i);
  const legacyTarget = kit.vaults.find(v => v.address !== fixed && v.token === "USDC")!;
  const other = await (await call("POST", "/intents", { kind: "earn_deposit", params: { vault: legacyTarget.address, amount: "2" } }, headers)).json();
  expect((await (await call("GET", `/intents/${other.island.intentId}`, undefined, headers)).json()).island).toEqual(other.island);
});

it.each([
  ["0.000279", "You've earned less than a cent."],
  ["-0.018", "You've lost $0.02."],
  [null, "Earnings are currently unavailable."],
] as const)("reads savings in everyday dollar amounts for earnings of %s", async (earned, expected) => {
  const { harness, kit } = await testApp();
  kit.getPosition = async () => ({ vaultName: "Savings", currentBalance: "2.000416", apy: 0.042, yieldEarned: earned });
  const result = await harness.runTool(ctx, "get_earn_positions", {});
  expect(result.summary).toBe(`You have $2.00 in savings. ${expected}`);
  expect(result.data).toMatchObject({ balance: "2.000416", earned });
  expect(await harness.runTool(ctx, "get_earn_positions", { view: "balance" })).toEqual({
    summary: "You have $2.00 in savings.", data: { balance: "2.000416" },
  });
  expect(await harness.runTool(ctx, "get_earn_positions", { view: "earnings" })).toEqual({
    summary: expected, data: { earned },
  });
});

it("keeps unreported earnings unknown and rejects provider read failures without inventing a zero balance", async () => {
  const { call, kit } = await testApp();
  kit.getPosition = async () => ({ vaultName: "Internal Name", currentBalance: "0.25", apy: 0.5, yieldEarned: null });
  expect(await (await call("GET", "/savings")).json()).toEqual({ available: true, annualRate: .042, balance: "0.25", earned: null });
  const { ArcieError } = await import("@arcie/core");
  kit.getPosition = async () => { throw new ArcieError("RPC_UNAVAILABLE"); };
  expect((await call("GET", "/savings")).status).toBe(502);
});


it("keeps voice proposals on the fixed product and shows savings language during preparation", async () => {
  const { harness, events, kit } = await testApp();
  const rejected = await harness.runTool(ctx, "propose_earn_deposit", { vault: "best", amount: "5" });
  expect(rejected.data).toMatchObject({ error: "INVALID_ARGS" });
  const proposed = await harness.runTool(ctx, "propose_earn_deposit", { amount: "5" });
  expect(proposed.island).toMatchObject({ action: "earn_deposit", title: "Add 5 USD to savings?" });
  const labels = (await events.readAfter(ctx.sessionId, 0)).flatMap(({ island }) =>
    island.kind === "steps" ? island.steps.map(({ label }) => label) : [],
  );
  expect(labels).toContain("Preparing to add 5 USD to savings");
  expect(kit.calls).toEqual([]);
});
