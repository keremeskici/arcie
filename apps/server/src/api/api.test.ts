import { describe, expect, it } from "vitest";
import { testApp } from "../testkit.js";

const S = { "x-arcie-session": "s1" };

describe("REST API", () => {
  it("GET /me returns the user, wallets and limits", async () => {
    const { call } = await testApp();
    const body = await (await call("GET", "/me")).json();
    expect(body).toMatchObject({
      user: { id: "demo" },
      wallets: [{ chain: "Arc_Testnet", address: "0x000000000000000000000000000000000000dEaD" }],
      limits: { maxPerTxUsd: 50 },
    });
  });

  it("GET /balances values each token and totals in USD", async () => {
    const { call } = await testApp();
    const body = await (await call("GET", "/balances")).json();
    expect(body.chains[0].tokens).toEqual([
      { token: "USDC", amount: "100", usd: 100 },
      { token: "EURC", amount: "20", usd: 21.74 },
      { token: "cirBTC", amount: "0", usd: 0 },
    ]);
    expect(body.totalUsd).toBe(121.74);
  });

  it("proposes from a button, confirms by tap, and refuses a second confirm with 409", async () => {
    const { call } = await testApp();
    const p = await call("POST", "/intents", { kind: "swap", params: { tokenIn: "USDC", tokenOut: "EURC", amountIn: "10" } }, S);
    expect(p.status).toBe(200);
    const proposed = await p.json();
    expect(proposed.island.kind).toBe("confirm");
    const id = proposed.island.intentId;

    const c1 = await call("POST", `/intents/${id}/confirm`, {}, S);
    expect(c1.status).toBe(200);
    expect(await c1.json()).toMatchObject({ status: "succeeded", island: { kind: "receipt" } });

    const c2 = await call("POST", `/intents/${id}/confirm`, {}, S);
    expect(c2.status).toBe(409);
    expect((await c2.json()).error.code).toBe("NOT_FOUND");

    expect(await (await call("GET", `/intents/${id}`, undefined, S)).json()).toMatchObject({ id, status: "succeeded" });
  });

  it("returns 404 NOT_FOUND for an unknown intent", async () => {
    const { call } = await testApp();
    const r = await call("POST", "/intents/nope/confirm", {}, S);
    expect(r.status).toBe(404);
    expect((await r.json()).error.code).toBe("NOT_FOUND");
  });

  it("returns 400 with the policy reason when a proposal is rejected", async () => {
    const { call } = await testApp();
    const r = await call("POST", "/intents", { kind: "send", params: { to: "Bob", amount: "60", token: "USDC" } }, S);
    expect(r.status).toBe(400);
    expect(await r.json()).toMatchObject({ error: { code: "POLICY_DENIED", message: expect.stringContaining("$50") } });
  });

  it("returns 400 for an unknown action kind", async () => {
    const { call } = await testApp();
    expect((await call("POST", "/intents", { kind: "teleport", params: {} }, S)).status).toBe(400);
  });

  it("cancels an intent by tap", async () => {
    const { call } = await testApp();
    const { island } = await (await call("POST", "/intents", { kind: "send", params: { to: "Bob", amount: "5", token: "USDC" } }, S)).json();
    expect((await call("POST", `/intents/${island.intentId}/cancel`, {}, S)).status).toBe(200);
    expect(await (await call("GET", `/intents/${island.intentId}`, undefined, S)).json()).toMatchObject({ status: "cancelled" });
  });

  it("does not show another user's intent", async () => {
    const { call, db } = await testApp();
    const { seed } = await import("@arcie/db");
    await seed(db, { userId: "eve" });
    const { island } = await (await call("POST", "/intents", { kind: "send", params: { to: "Bob", amount: "5", token: "USDC" } }, S)).json();
    expect((await call("GET", `/intents/${island.intentId}`, undefined, { "x-arcie-user": "eve" })).status).toBe(404);
  });

  it("answers a choice by tap", async () => {
    const { call } = await testApp();
    const { island } = await (await call("POST", "/intents", { kind: "send", params: { to: "alice", amount: "5", token: "USDC" } }, S)).json();
    expect(island.kind).toBe("choice");
    expect((await call("POST", `/choices/${island.choiceId}`, { optionId: island.options[0].id }, S)).status).toBe(200);
    expect((await call("POST", `/choices/${island.choiceId}`, { optionId: "nope" }, S)).status).toBe(404);
  });

  it("lists and adds contacts, rejecting bad addresses", async () => {
    const { call } = await testApp();
    expect((await (await call("GET", "/contacts")).json()).contacts).toHaveLength(3);
    expect((await call("POST", "/contacts", { name: "Carol", address: "0x5555555555555555555555555555555555555555" })).status).toBe(200);
    expect((await call("POST", "/contacts", { name: "Dan", address: "0x123" })).status).toBe(400);
    expect((await (await call("GET", "/contacts")).json()).contacts).toHaveLength(4);
  });

  it("lists recent activity from the audit log", async () => {
    const { call } = await testApp();
    const { island } = await (await call("POST", "/intents", { kind: "send", params: { to: "Bob", amount: "5", token: "USDC" } }, S)).json();
    await call("POST", `/intents/${island.intentId}/confirm`, {}, S);
    const { items } = await (await call("GET", "/activity")).json();
    expect(items[0]).toMatchObject({ type: "intent.succeeded", intentId: island.intentId });
  });

  it("GET /config returns client runtime configuration", async () => {
    const { call } = await testApp({ privyAppId: "privy-123", elevenLabsAgentId: "agent-456" });
    const r = await call("GET", "/config");
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({
      authMode: "dev",
      demoUserId: "demo",
      privyAppId: "privy-123",
      elevenLabsAgentId: "agent-456",
    });
  });

  it("GET /vaults lists earning vaults and positions for the user", async () => {
    const { call } = await testApp();
    const r = await call("GET", "/vaults");
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.vaults.length).toBeGreaterThan(0);
    expect(body.vaults[0]).toMatchObject({ name: expect.any(String), token: "USDC", apy: expect.any(Number) });
    expect(Array.isArray(body.positions)).toBe(true);
  });

  it("POST /quotes/swap returns a live swap quote without creating an intent", async () => {
    const { call, harness } = await testApp();
    const r = await call("POST", "/quotes/swap", { tokenIn: "USDC", tokenOut: "EURC", amountIn: "10" }, S);
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.summary).toMatch(/10 USD\b/);
    expect(body.data).toMatchObject({ estimatedOut: expect.any(String), minOut: expect.any(String) });
    expect(harness.intents.listForUser("demo", 10)).toHaveLength(0);
  });

  it("POST /receive publishes a receive island for the user's wallet", async () => {
    const { call } = await testApp();
    const r = await call("POST", "/receive", {}, S);
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.island).toMatchObject({
      kind: "receive",
      address: "0x000000000000000000000000000000000000dEaD",
      chain: "Arc_Testnet",
    });
  });

  it("POST /chat runs an agent turn for the authenticated user without exposing LLM_SHARED_SECRET", async () => {
    const { call } = await testApp({
      llmSecret: "super-secret-llm-key",
      agent: async function* (ctx, msgs) {
        yield `hi ${ctx.userId}: ${String(msgs.at(-1)?.content ?? "")}`;
      },
    });
    const r = await call("POST", "/chat", { messages: [{ role: "user", content: "balance?" }] }, S);
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.reply).toBe("hi demo: balance?");
  });

  it("GET / serves the wireframe UI HTML with valid inline script syntax", async () => {
    const { app } = await testApp();
    const r = await app.request("/");
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toContain("text/html");
    const html = await r.text();
    expect(html).toContain("Arcie Wireframe");
    const script = html.match(/<script type="module">([\s\S]*?)<\/script>/)?.[1] ?? "";
    expect(script.length).toBeGreaterThan(100);
    const { transformSync } = await import("esbuild");
    expect(() => transformSync(script, { loader: "js", format: "esm" })).not.toThrow();
  });
});

describe("shared proposal validation (F7)", () => {
  it.each([
    { kind: "send", params: { to: "Bob", amount: 5 } },
    { kind: "send", params: { to: "Bob", amount: "5", token: "ETH" } },
    { kind: "swap", params: { tokenIn: "USDC", tokenOut: "EURC", amountIn: "5", maxSlippageBps: -1 } },
    { kind: "swap", params: { tokenIn: "USDC", tokenOut: "EURC", amountIn: "5", maxSlippageBps: "100" } },
  ])("returns controlled validation errors for $kind: $params", async (body) => {
    const { call, harness, kit } = await testApp();
    const result = await call("POST", "/intents", body, S);
    expect(result.status).toBe(400);
    expect(await result.json()).toMatchObject({ error: { code: "INVALID_ARGS" } });
    expect(harness.intents.listForUser("demo", 10)).toHaveLength(0);
    expect(kit.calls).toHaveLength(0);
  });

  it.each([
    { kind: "send", params: { to: "Bob", amount: "5" }, title: "Send 5 USD to Bob?" },
    { kind: "earn_deposit", params: { amount: "5" }, title: "Put 5 USD into Fake High Yield USDC?" },
  ])("applies the same defaults for $kind through REST", async ({ title, ...body }) => {
    const { call } = await testApp();
    const result = await call("POST", "/intents", body, S);
    expect(result.status).toBe(200);
    expect((await result.json()).island.title).toBe(title);
  });
});

it("keeps provider diagnostics internal while returning useful activity (F8)", async () => {
  const { ArcieError } = await import("@arcie/core");
  const { call, kit } = await testApp();
  const { island } = await (await call("POST", "/intents", { kind: "send", params: { to: "Bob", amount: "5" } }, S)).json();
  kit.send = async () => { throw new ArcieError("INSUFFICIENT_BALANCE", { detail: new Error("synthetic-private-provider-debug") }); };
  const result = await (await call("POST", `/intents/${island.intentId}/confirm`, {}, S)).json();
  const activity = await (await call("GET", "/activity")).json();
  const intent = await (await call("GET", `/intents/${island.intentId}`, undefined, S)).json();
  expect(JSON.stringify({ result, activity, intent })).not.toContain("synthetic-private-provider-debug");
  expect(activity.items[0]).toMatchObject({ type: "intent.failed", summary: expect.any(String) });
});
