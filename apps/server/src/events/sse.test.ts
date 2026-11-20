import type { IslandPayload } from "@arcie/core";
import { describe, expect, it } from "vitest";
import { testApp } from "../testkit.js";

/** Reads SSE frames until `want` matches an island or the timeout passes. */
async function readIslands(res: Response, want: (i: IslandPayload) => boolean, timeoutMs = 1500) {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  const seen: IslandPayload[] = [];
  let buf = "";
  const deadline = Date.now() + timeoutMs;
  try {
    while (Date.now() < deadline) {
      const next = await Promise.race([reader.read(), new Promise<null>((r) => setTimeout(() => r(null), deadline - Date.now()))]);
      if (!next || next.done) break;
      buf += decoder.decode(next.value, { stream: true });
      let i;
      while ((i = buf.indexOf("\n\n")) >= 0) {
        const frame = buf.slice(0, i);
        buf = buf.slice(i + 2);
        if (!frame.includes("event: island")) continue;
        const island = JSON.parse(frame.split("\n").find((l) => l.startsWith("data: "))!.slice(6)) as IslandPayload;
        seen.push(island);
        if (want(island)) return seen;
      }
    }
    return seen;
  } finally {
    await reader.cancel();
  }
}

const sendBody = { kind: "send", params: { to: "Bob", amount: "5", token: "USDC" } };

describe("GET /events", () => {
  it("streams the confirm island for its own session only", async () => {
    const { app, call } = await testApp();
    const res = await app.request("/events?sessionId=s1");
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    const other = await (await call("POST", "/intents", sendBody, { "x-arcie-session": "s2" })).json();
    const mine = await (await call("POST", "/intents", sendBody, { "x-arcie-session": "s1" })).json();
    const seen = await readIslands(res, (i) => i.kind === "confirm");
    const confirms = seen.filter((i) => i.kind === "confirm");
    expect(confirms).toHaveLength(1);
    expect(confirms[0]).toMatchObject({ intentId: mine.island.intentId });
    expect(confirms[0]).not.toMatchObject({ intentId: other.island.intentId });
  });

  it("replays the open confirm card when a client connects late", async () => {
    const { app, call } = await testApp();
    const p = await (await call("POST", "/intents", sendBody, { "x-arcie-session": "s1" })).json();
    const res = await app.request("/events?sessionId=s1");
    const seen = await readIslands(res, (i) => i.kind === "confirm");
    expect(seen[0]).toMatchObject({ kind: "confirm", intentId: p.island.intentId });
  });

  it("requires a sessionId", async () => {
    const { app } = await testApp();
    expect((await app.request("/events")).status).toBe(400);
  });
});

describe("onramp routes", () => {
  it("carries a checkout request ID through both REST and SSE and rejects malformed IDs", async () => {
    const { call, bus } = await testApp();
    const islands: unknown[] = [];
    const off = bus.subscribe("s1", (island) => islands.push(island));
    const requestId = "c093ca67-ddb4-405d-8d56-14fd37f4e969";
    const r = await call("POST", "/onramp/sessions", { requestId }, { "x-arcie-session": "s1" });
    expect((await r.json()).island).toMatchObject({ requestId });
    expect(islands).toContainEqual(expect.objectContaining({ kind: "onramp", requestId }));
    expect((await call("POST", "/onramp/sessions", { requestId: "invalid" })).status).toBe(400);
    off();
  });
  it("mints a session island and is never cached", async () => {
    const { call } = await testApp();
    const r = await call("POST", "/onramp/sessions", { amount: "25" });
    expect(r.status).toBe(200);
    expect(r.headers.get("cache-control")).toBe("no-store");
    expect((await r.json()).island).toMatchObject({ kind: "onramp", token: "USDC", amount: "25", environment: "sandbox", sessionId: expect.any(String), expiresAt: expect.any(String), widgetUrl: expect.stringContaining("https://onramp-sandbox.arc.io/") });
  });

  it("rejects a bad amount", async () => {
    const { call } = await testApp();
    const r = await call("POST", "/onramp/sessions", { amount: "lots" });
    expect(r.status).toBe(400);
    expect((await r.json()).error.code).toBe("INVALID_AMOUNT");
  });

  it("records widget lifecycle events", async () => {
    const { call } = await testApp();
    expect((await call("POST", "/onramp/events", { type: "settled", payload: { amount: "25" } })).status).toBe(200);
    expect((await call("POST", "/onramp/events", { type: "weird" })).status).toBe(400);
    const { items } = await (await call("GET", "/activity")).json();
    expect(items[0]).toMatchObject({ type: "onramp.settled" });
  });
});

describe("GET /events disconnect during the late-joiner lookup", () => {
  it("releases the bus subscription when the client aborts while the lookup is pending", async () => {
    const { app, bus, harness } = await testApp();
    let live = 0;
    const subscribe = bus.subscribe.bind(bus);
    bus.subscribe = (sid, fn) => {
      live++;
      const off = subscribe(sid, fn);
      let released = false;
      return () => {
        if (!released) live--;
        released = true;
        off();
      };
    };
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const open = harness.intents.openForSession.bind(harness.intents);
    harness.intents.openForSession = async (...args) => {
      await gate;
      return open(...args);
    };
    
    const res = await app.request("/events?sessionId=s1");
    const reader = res.body!.getReader();
    const pending = reader.read().catch(() => null);
    await new Promise((r) => setTimeout(r, 50));
    expect(live).toBe(1);
    await reader.cancel(); // client disconnect
    await new Promise((r) => setTimeout(r, 50));
    expect(live).toBe(0);
    release();
    await pending;
    await new Promise((r) => setTimeout(r, 50));
    expect(live).toBe(0);
  });
});
