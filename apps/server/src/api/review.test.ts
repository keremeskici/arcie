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

it("only accepts the revision of the displayed replacement quote", async () => {
  const { call, kit, harness } = await testApp();
  const { island } = await (await call("POST", "/intents", { kind: "swap", params: { tokenIn: "USDC", tokenOut: "EURC", amountIn: "4" } })).json();
  const path = `/intents/${island.intentId}/confirm`;
  await harness.intents.patch(island.intentId, { quoteAt: new Date(Date.now() - 35_000).toISOString() });
  kit.setSwapRate("USDC", "EURC", 0.6);
  const refreshed = await (await call("POST", path, { revision: island.revision })).json();
  expect(refreshed.status).toBe("awaiting_confirmation");
  expect(refreshed.island.revision).toBeGreaterThan(island.revision);
  for (const body of [{ revision: island.revision }, {}]) {
    expect((await (await call("POST", path, body)).json()).island).toEqual(refreshed.island);
  }
  expect(kit.calls).toHaveLength(0);
  expect((await (await call("POST", path, { revision: refreshed.island.revision })).json()).status).toBe("succeeded");
});

it("logs only a safe operation label for unexpected errors and optional LLM diagnostics", async () => {
  const { vi } = await import("vitest");
  const diagnostic = vi.spyOn(console, "log").mockImplementation(() => {});
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  vi.stubEnv("LOG_LLM_REQUESTS", "1");
  try {
    const t = await testApp({ identify: async () => { throw new Error("synthetic-private-detail"); } });
    await t.call("GET", "/me");
    await t.call("POST", "/v1/chat/completions", { session_id: "synthetic-private-detail", messages: [{ role: "user", content: "hello" }] });
    expect([...diagnostic.mock.calls, ...error.mock.calls].flat().map(String).join(" ")).not.toContain("synthetic-private-detail");
  } finally { vi.unstubAllEnvs(); vi.restoreAllMocks(); }
});

it("redisplays an imported legacy disclosure with a usable revision before accepting its first tap", async () => {
  const { db, call, kit } = await testApp();
  const { intents } = await import("@arcie/db");
  const { eq } = await import("drizzle-orm");
  const { island } = await (await call("POST", "/intents", { kind: "send", params: { to: "Bob", token: "USDC", amount: "1" } })).json();
  const { revision: _, ...legacy } = island;
  await db.update(intents).set({ revision: 0, preview: { island: legacy } }).where(eq(intents.id, island.intentId));
  const path = `/intents/${island.intentId}/confirm`;
  const first = await (await call("POST", path, {})).json();
  expect(first).toMatchObject({ status: "awaiting_confirmation", island: { revision: 0 } });
  expect(kit.calls).toHaveLength(0);
  expect((await (await call("POST", path, { revision: first.island.revision })).json()).status).toBe("succeeded");
});

it.each(["dev", "privy"] as const)("requires the new revision after the first requote of a revision-zero import in %s", async (authMode) => {
  const { db, call, kit } = await testApp({ authMode });
  const { intents } = await import("@arcie/db");
  const { eq } = await import("drizzle-orm");
  const headers = { authorization: "Bearer tok-demo" };
  const { island } = await (await call("POST", "/intents", { kind: "swap", params: { tokenIn: "USDC", tokenOut: "EURC", amountIn: "4" } }, headers)).json();
  const { revision: _, ...legacy } = island;
  const { id, preview } = (await db.select().from(intents))[0]!;
  await db.update(intents).set({ revision: 0, preview: { estimatedOut: preview?.estimatedOut, island: legacy }, quoteAt: new Date(Date.now()-35_000).toISOString() }).where(eq(intents.id, id));
  kit.setSwapRate("USDC", "EURC", 0.6);
  const path = `/intents/${id}/confirm`;
  const refreshed = await (await call("POST", path, { revision: 0 }, headers)).json();
  expect(refreshed).toMatchObject({ status: "awaiting_confirmation", island: { revision: 1 } });
  expect((await (await call("POST", path, {}, headers)).json()).status).toBe("awaiting_confirmation");
  expect(kit.calls).toHaveLength(0);
  expect((await (await call("POST", path, { revision: 1 }, headers)).json()).status).toBe("succeeded");
});

it("permits reopening only a current unexpired review in its originating session", async () => {
  const { call, harness } = await testApp();
  const headers = { "x-arcie-session": "here" };
  const { island } = await (await call("POST", "/intents", {kind:"send", params:{to:"Bob",amount:"1"}}, headers)).json();
  const path = `/intents/${island.intentId}`;
  expect(await (await call("GET", path, undefined, headers)).json()).toMatchObject({canReview:true});
  expect(await (await call("GET", path)).json()).toMatchObject({canReview:false});
  await harness.intents.patch(island.intentId, { expiresAt: new Date(0).toISOString() });
  expect(await (await call("GET", path, undefined, headers)).json()).toMatchObject({status:"expired",canReview:false,island:null});
});

it("refreshes a submitted swap from its provider without a server restart or a second swap", async () => {
  const { call, kit, harness } = await testApp();
  const h = { "x-arcie-session": "swap-session" };
  const draft = await (await call("POST", "/intents", {kind:"swap", params:{tokenIn:"USDC", tokenOut:"EURC", amountIn:"5"}}, h)).json();
  const id = draft.island.intentId;
  kit.setPendingNext();
  expect(await (await call("POST", `/intents/${id}/confirm`, {}, h)).json()).toMatchObject({status:"executing"});
  const hash = (await harness.intents.get(id))!.txHash!;
  kit.settle(hash);
  expect(await (await call("GET", `/intents/${id}`, undefined, h)).json()).toMatchObject({status:"succeeded",island:{kind:"receipt",txHash:hash}});
  expect(kit.calls.map(c => c.method)).toEqual(["swap"]);
});

it("gives existing wallets a checksummed receive address that can be pasted into Send", async () => {
  const { wallets } = await import("@arcie/db");
  const { call, db, kit } = await testApp();
  const { DEMO_WALLET } = await import("../testkit.js");
  kit.setBalance({ ...DEMO_WALLET, address: "0x000000000000000000000000000000000000dead" }, "USDC", "10");
  await db.update(wallets).set({ address: "0x000000000000000000000000000000000000dead" });
  const receive = await (await call("POST", "/receive")).json();
  const account = await (await call("GET", "/me")).json();
  const session = await (await call("POST", "/auth/session")).json();
  for (const address of [receive.island.address, account.wallets[0].address, session.wallet.address]) {
    expect(address).toBe("0x000000000000000000000000000000000000dEaD");
    expect((await call("POST", "/intents", { kind:"send", params:{ to:address, amount:"1" } })).status).toBe(200);
  }
});
