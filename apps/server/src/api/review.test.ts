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
