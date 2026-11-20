import { seed, sessions } from "@arcie/db";
import type { HarnessCtx } from "@arcie/harness";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import type { AgentFn } from "../llm/route.js";
import { testApp } from "../testkit.js";

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
    db.insert(sessions).values({ id: "eves-session", userId: "eve", channel: "voice", userTurn: 0 }).run();
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
    expect(db.select().from(sessions).where(eq(sessions.id, r.sessionId)).get()).toMatchObject({ userId: "demo", channel: "voice" });
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

  it("preserves turn order across a reopened conversation and rejects the old conversation", async () => {
    const seen: HarnessCtx[] = [];
    const agent: AgentFn = async function* (ctx) {
      seen.push(ctx);
      yield "ok";
    };
    const { call } = await testApp({ authMode: "privy", agent });
    const { sessionId } = await (await call("POST", "/voice/session", {}, bearer("demo"))).json();
    const headers = { ...bearer("demo"), "x-arcie-session": sessionId };
    const start = async () => {
      const response = await call("POST", "/voice/conversation", {}, headers);
      expect(response.status).toBe(200);
      return (await response.json()).conversationId as string;
    };
    const speak = (conversationId: string, count: number) => call("POST", "/v1/chat/completions", {
      messages: Array.from({ length: count }, (_, i) => ({ role: "user", content: `Turn ${i + 1}` })),
      elevenlabs_extra_body: { session_id: sessionId, arcie_conversation_id: conversationId },
    });
    const first = await start();
    expect((await speak(first, 7)).status).toBe(200);
    expect((await call("POST", "/voice/conversation", {}, { ...bearer("eve"), "x-arcie-session": sessionId })).status).toBe(401);
    const next = await start();
    expect((await speak(next, 1)).status).toBe(200);
    expect((await speak(first, 8)).status).toBe(409);
    expect((await speak(next, 2)).status).toBe(200);
    expect(seen.map((ctx) => ctx.userTurn)).toEqual([7, 8, 9]);
  });

  it("rejects unknown and expired sessions on the custom-LLM endpoint", async () => {
    const { call, db } = await testApp({ authMode: "privy" });
    const body = (sid: string) => ({ messages: [{ role: "user", content: "hi" }], session_id: sid });
    expect((await call("POST", "/v1/chat/completions", body("made-up"))).status).toBe(401);
    expect((await call("POST", "/v1/chat/completions", { messages: [{ role: "user", content: "hi" }] })).status).toBe(401);
    const { sessionId } = await (await call("POST", "/voice/session", {}, bearer("demo"))).json();
    db.update(sessions).set({ expiresAt: new Date(Date.now() - 1000).toISOString() }).where(eq(sessions.id, sessionId)).run();
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
