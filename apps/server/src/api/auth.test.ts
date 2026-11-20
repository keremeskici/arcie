import { seed, sessions } from "@arcie/db";
import type { HarnessCtx } from "@arcie/harness";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import type { AgentFn } from "../llm/route.js";
import { latch, testApp } from "../testkit.js";

const bearer = (userId: string) => ({ authorization: `Bearer tok-${userId}` });

describe("identify in privy mode", () => {
  it("rejects a request without a bearer token", async () => {
    const { call } = await testApp({ authMode: "privy" });
    const r = await call("GET", "/balances");
    expect(r.status).toBe(401);
    expect((await r.json()).error.code).toBe("UNAUTHENTICATED");
  });

  it("rejects a bad token", async () => {
    const { call } = await testApp({ authMode: "privy" });
    expect((await call("GET", "/balances", undefined, { authorization: "Bearer nope" })).status).toBe(401);
  });

  it("serves the verified user", async () => {
    const { call } = await testApp({ authMode: "privy" });
    const r = await call("GET", "/me", undefined, bearer("demo"));
    expect(r.status).toBe(200);
    expect((await r.json()).user.id).toBe("demo");
  });

  it("refuses a session header that belongs to someone else", async () => {
    const { call, db } = await testApp({ authMode: "privy" });
    await seed(db, { userId: "eve" });
    await db.insert(sessions).values({ id: "eves-session", userId: "eve", channel: "voice", userTurn: 0 });
    const r = await call("POST", "/intents", { kind: "send", params: { to: "Bob", amount: "1", token: "USDC" } }, { ...bearer("demo"), "x-arcie-session": "eves-session" });
    expect(r.status).toBe(401);
  });
});

describe("POST /auth/session", () => {
  it("onboards a new user once and returns the same wallet every time", async () => {
    const { call } = await testApp({ authMode: "privy" });
    const a = await (await call("POST", "/auth/session", {}, bearer("newbie"))).json();
    const b = await (await call("POST", "/auth/session", {}, bearer("newbie"))).json();
    expect(a.user).toMatchObject({ id: "newbie", displayName: "User newbie" });
    expect(a.wallet.address).toMatch(/^0x[0-9a-fA-F]{40}$/);
    expect(b.wallet).toEqual(a.wallet);
    expect(a.limits.maxPerTxUsd).toBe(50);
  });

  it("requires login", async () => {
    const { call } = await testApp({ authMode: "privy" });
    expect((await call("POST", "/auth/session", {})).status).toBe(401);
  });
});

describe("voice sessions", () => {
  it("mints an unguessable, expiring session for the user", async () => {
    const { call, db } = await testApp({ authMode: "privy" });
    const r = await (await call("POST", "/voice/session", {}, bearer("demo"))).json();
    expect(r.sessionId).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const ms = new Date(r.expiresAt).getTime() - Date.now();
    expect(ms).toBeGreaterThan(119 * 60_000);
    expect(ms).toBeLessThanOrEqual(120 * 60_000);
    expect((await db.select().from(sessions).where(eq(sessions.id, r.sessionId)).limit(1))[0]).toMatchObject({ userId: "demo", channel: "voice" });
  });

  it("binds the custom-LLM request to the session's user, ignoring user_id in the body", async () => {
    const seen: HarnessCtx[] = [];
    const agent: AgentFn = async function* (ctx) {
      seen.push(ctx);
      yield "ok";
    };
    const { call } = await testApp({ authMode: "privy", agent });
    const { sessionId } = await (await call("POST", "/voice/session", {}, bearer("demo"))).json();
    const r = await call("POST", "/v1/chat/completions", {
      messages: [{ role: "user", content: "hi" }],
      user_id: "someone-else",
      elevenlabs_extra_body: { user_id: "someone-else", session_id: sessionId },
    });
    expect(r.status).toBe(200);
    expect(seen[0]).toMatchObject({ userId: "demo", sessionId, channel: "voice" });
  });

  it("rejects unknown and expired sessions on the custom-LLM endpoint", async () => {
    const { call, db } = await testApp({ authMode: "privy" });
    const body = (sid: string) => ({ messages: [{ role: "user", content: "hi" }], session_id: sid });
    expect((await call("POST", "/v1/chat/completions", body("made-up"))).status).toBe(401);
    expect((await call("POST", "/v1/chat/completions", { messages: [{ role: "user", content: "hi" }] })).status).toBe(401);
    const { sessionId } = await (await call("POST", "/voice/session", {}, bearer("demo"))).json();
    await db.update(sessions).set({ expiresAt: new Date(Date.now() - 1000).toISOString() }).where(eq(sessions.id, sessionId));
    expect((await call("POST", "/v1/chat/completions", body(sessionId))).status).toBe(401);
  });

  it("only streams events for a valid voice session", async () => {
    const { app, call } = await testApp({ authMode: "privy" });
    expect((await app.request("/events?sessionId=made-up")).status).toBe(401);
    const { sessionId } = await (await call("POST", "/voice/session", {}, bearer("demo"))).json();
    const ok = await app.request(`/events?sessionId=${sessionId}`);
    expect(ok.status).toBe(200);
    await ok.body?.cancel();
  });
});

it("binds implicit screen sessions to the verified user and requires issued live IDs in headers", async () => {
  const { db, call } = await testApp({ authMode: "privy" });
  expect((await call("POST", "/receive", {}, bearer("demo"))).status).toBe(200);
  expect((await db.select().from(sessions).where(eq(sessions.id, "default:demo")))[0]?.userId).toBe("demo");
  const { sessionId } = await (await call("POST", "/voice/session", {}, bearer("demo"))).json();
  await db.update(sessions).set({ expiresAt: new Date(0).toISOString() }).where(eq(sessions.id, sessionId));
  for (const sid of [sessionId, "unissued"]) {
    expect((await call("POST", "/receive", {}, { ...bearer("demo"), "x-arcie-session": sid })).status).toBe(401);
  }
});

it.each(["publish", "confirm"] as const)("new typed turn fences an older voice %s on another instance", async (kind) => {
  const { createDb } = await import("@arcie/db");
  const a = await testApp({ authMode: "privy" });
  const peer = createDb(a.url);
  const sessionId = (await (await a.call("POST", "/voice/session", {}, bearer("demo"))).json()).sessionId;
  const headers = { ...bearer("demo"), "x-arcie-session": sessionId };
  const proposed = await (await a.call("POST", "/intents", { kind: "send", params: { to: "Bob", token: "USDC", amount: "1" } }, headers)).json();
  const entered = latch();
  const gate = latch();
  const agent: AgentFn = async function* (ctx) {
    if (kind === "confirm") { entered.resolve(); await gate.promise; }
    try {
      if (kind === "publish") {
        a.kit.estimateSend = async () => { entered.resolve(); await gate.promise; return { fee: { amount: "0", token: "USDC", label: "fee" } }; };
        await a.harness.propose(ctx, "send", { to: "Bob", token: "USDC", amount: "2" });
      } else await a.harness.confirm(ctx, proposed.island.intentId, "voice");
    } catch { /* interrupted model work */ }
    yield "ok";
  };
  try {
    const old = await testApp({ db: a.db, authMode: "privy", agent });
    const newer = await testApp({ db: peer.db, authMode: "privy" });
    const msg = { role: "user", content: "fixture" };
    const working = old.call("POST", "/v1/chat/completions", { session_id: sessionId, messages: [msg] });
    await entered.promise;
    expect((await newer.call("POST", "/chat", { messages: [msg, msg] }, headers)).status).toBe(200);
    gate.resolve();
    await working;
    expect(a.kit.calls).toHaveLength(0);
    expect((await a.harness.intents.get(proposed.island.intentId))?.status).toBe("awaiting_confirmation");
  } finally { gate.resolve(); await peer.close(); }
});

it("keeps the owner of a default namespace during concurrent requests from independent apps", async () => {
  const { createDb } = await import("@arcie/db");
  const a = await testApp({ authMode: "privy" });
  const peer = createDb(a.url);
  try {
    await seed(a.db, { userId: "second" });
    const b = await testApp({ db: peer.db, authMode: "privy" });
    const losing = { ...bearer("second"), "x-arcie-session": "default:demo" };
    const [mine, other] = await Promise.all([a.call("POST", "/receive", {}, bearer("demo")), b.call("POST", "/receive", {}, losing)]);
    expect([mine.status, other.status]).toEqual([200, 401]);
    expect((await a.db.select().from(sessions).where(eq(sessions.id, "default:demo")))[0]?.userId).toBe("demo");
  } finally { await peer.close(); }
});
