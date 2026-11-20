import { describe, expect, it } from "vitest";
import { testApp } from "../testkit.js";

describe("review API regressions", () => {
  it("requires a checksum when adding a raw contact address (F10)", async () => {
    const { call } = await testApp();
    const bad = await call("POST", "/contacts", { name: "Raw", address: "0x000000000000000000000000000000000000dead" });
    expect(bad.status).toBe(400);
    expect((await bad.json()).error.code).toBe("INVALID_RECIPIENT");
    const good = await call("POST", "/contacts", { name: "Checked", address: "0x000000000000000000000000000000000000dEaD" });
    expect(good.status).toBe(200);
  });
});

it("returns the durable terminal receipt after a normal confirmation (F11)", async () => {
  const { call } = await testApp();
  const headers = { "x-arcie-session": "s1" };
  const { island } = await (await call("POST", "/intents", { kind: "send", params: { to: "Bob", amount: "5" } }, headers)).json();
  const result = await (await call("POST", `/intents/${island.intentId}/confirm`, {}, headers)).json();
  const stored = await (await call("GET", `/intents/${island.intentId}`)).json();
  expect(stored.island).toEqual(result.island);
});

it("reports a partial balance instead of valuing unpriced tokens at zero (F13)", async () => {
  const { ArcieError } = await import("@arcie/core");
  const { DEMO_WALLET } = await import("../testkit.js");
  const { call, kit } = await testApp();
  kit.setBalance(DEMO_WALLET, "cirBTC", "0.001");
  const rates = kit.getUsdRates.bind(kit);
  kit.getUsdRates = async (chain, tokens) => {
    if (tokens.includes("cirBTC")) throw new ArcieError("CIRCLE_API_ERROR");
    return rates(chain, tokens);
  };
  const body = await (await call("GET", "/balances")).json();
  expect(body.totalUsd).toBeNull();
  expect(body.knownSubtotalUsd).toBe(121.74);
  expect(body.chains[0].tokens).toContainEqual({ token: "cirBTC", amount: "0.001", usd: null });
});

it("permits reopening only a current unexpired review in its originating session", async () => {
  const { call, harness } = await testApp();
  const headers = { "x-arcie-session": "here" };
  const { island } = await (await call("POST", "/intents", {kind:"send", params:{to:"Bob",amount:"1"}}, headers)).json();
  const path = `/intents/${island.intentId}`;
  expect(await (await call("GET", path, undefined, headers)).json()).toMatchObject({canReview:true});
  expect(await (await call("GET", path)).json()).toMatchObject({canReview:false});
  harness.intents.patch(island.intentId, {expiresAt:new Date(0).toISOString()});
  expect(await (await call("GET", path, undefined, headers)).json()).toMatchObject({status:"expired",canReview:false,island:null});
});

it("refreshes a submitted swap from its provider without a server restart or a second swap", async () => {
  const { call, kit, harness } = await testApp();
  const h = { "x-arcie-session": "swap-session" };
  const draft = await (await call("POST", "/intents", {kind:"swap", params:{tokenIn:"USDC", tokenOut:"EURC", amountIn:"5"}}, h)).json();
  const id = draft.island.intentId;
  kit.setPendingNext();
  expect(await (await call("POST", `/intents/${id}/confirm`, {}, h)).json()).toMatchObject({status:"executing"});
  const hash = harness.intents.get(id)!.txHash!;
  kit.settle(hash);
  expect(await (await call("GET", `/intents/${id}`, undefined, h)).json()).toMatchObject({status:"succeeded",island:{kind:"receipt",txHash:hash}});
  expect(kit.calls.map(c => c.method)).toEqual(["swap"]);
});

it("gives existing wallets a checksummed receive address that can be pasted into Send", async () => {
  const { wallets } = await import("@arcie/db");
  const { call, db, kit } = await testApp();
  const { DEMO_WALLET } = await import("../testkit.js");
  kit.setBalance({ ...DEMO_WALLET, address: "0x000000000000000000000000000000000000dead" }, "USDC", "10");
  db.update(wallets).set({ address: "0x000000000000000000000000000000000000dead" }).run();
  const receive = await (await call("POST", "/receive")).json();
  const account = await (await call("GET", "/me")).json();
  const session = await (await call("POST", "/auth/session")).json();
  for (const address of [receive.island.address, account.wallets[0].address, session.wallet.address]) {
    expect(address).toBe("0x000000000000000000000000000000000000dEaD");
    expect((await call("POST", "/intents", { kind:"send", params:{ to:address, amount:"1" } })).status).toBe(200);
  }
});
