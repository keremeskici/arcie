import type { IslandPayload } from "@arcie/core";
import { createDb } from "@arcie/db";
import { sessionEvents } from "@arcie/db";
import { lt } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { testApp } from "../testkit.js";

interface Frame { id?: string; event?: string; data?: string; raw: string }

/** Reads raw SSE frames until `done(frames)` is true, the stream ends, or the timeout passes. */
async function readFrames(res: Response, done: (frames: Frame[]) => boolean = () => false, timeoutMs = 2000): Promise<Frame[]> {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  const frames: Frame[] = [];
  let buf = "";
  const deadline = Date.now() + timeoutMs;
  try {
    while (Date.now() < deadline) {
      const next = await Promise.race([reader.read(), new Promise<null>((r) => setTimeout(() => r(null), deadline - Date.now()))]);
      if (!next || next.done) break;
      buf += decoder.decode(next.value, { stream: true });
      let i;
      while ((i = buf.indexOf("\n\n")) >= 0) {
        const raw = buf.slice(0, i);
        buf = buf.slice(i + 2);
        const field = (name: string) => raw.split("\n").find((l) => l.startsWith(`${name}: `))?.slice(name.length + 2);
        frames.push({ raw, ...(field("id") !== undefined ? { id: field("id")! } : {}), ...(field("event") !== undefined ? { event: field("event")! } : {}), ...(field("data") !== undefined ? { data: field("data")! } : {}) });
      }
      if (done(frames)) break;
    }
    return frames;
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}
const islandFrames = (frames: Frame[]) => frames.filter((f) => f.event === "island");
const kinds = (frames: Frame[]) => islandFrames(frames).map((f) => (JSON.parse(f.data!) as IslandPayload).kind);
const receiveIsland = (address: string): IslandPayload => ({ kind: "receive", address, chain: "Arc_Testnet", tokens: ["USDC"] });

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

  it("replays a pending contact choice on reconnect and then replays the selected review", async () => {
    const { app, call, kit } = await testApp();
    const headers = { "x-arcie-session": "s1" };
    const { island: choice } = await (await call("POST", "/intents", { kind: "send", params: { to: "Alice", amount: "1", token: "EURC" } }, headers)).json();
    const waitForChoice = await app.request("/events?sessionId=s1");
    expect((await readIslands(waitForChoice, (i) => i.kind === "choice"))[0]).toEqual(choice);
    const option = choice.options.find((o: { label: string }) => o.label === "Alice Smith");
    const selected = await call("POST", `/choices/${choice.choiceId}`, { optionId: option.id, prepare: true }, headers);
    expect(selected.status).toBe(200);
    const reconnect = await app.request("/events?sessionId=s1");
    expect((await readIslands(reconnect, (i) => i.kind === "confirm"))[0]).toMatchObject({
      kind: "confirm", send: { amount: "1", token: "EURC", recipient: "Alice Smith" },
    });
    expect(kit.calls).toEqual([]);
  });

  it("requires a sessionId", async () => {
    const { app } = await testApp();
    expect((await app.request("/events")).status).toBe(400);
  });
});

describe("onramp routes", () => {
  it("carries a checkout request ID through both REST and SSE and rejects malformed IDs", async () => {
    const { call, events } = await testApp();
    const requestId = "c093ca67-ddb4-405d-8d56-14fd37f4e969";
    const r = await call("POST", "/onramp/sessions", { requestId }, { "x-arcie-session": "s1" });
    expect((await r.json()).island).toMatchObject({ requestId });
    expect((await events.readAfter("s1", 0)).map((r) => r.island)).toContainEqual(expect.objectContaining({ kind: "onramp", requestId }));
    expect((await call("POST", "/onramp/sessions", { requestId: "invalid" })).status).toBe(400);
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

describe("GET /events disconnect during the initial snapshot", () => {
  it("stops reading the log when the client aborts while the snapshot is pending", async () => {
    const { app, events } = await testApp({ sse: { pollMs: 20 } });
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    events.onSnapshotRead = () => gate;
    let reads = 0;
    const readAfter = events.readAfter.bind(events);
    events.readAfter = async (...args) => {
      reads++;
      return readAfter(...args);
    };
    const res = await app.request("/events?sessionId=s1");
    const reader = res.body!.getReader();
    const pending = reader.read().catch(() => null);
    await new Promise((r) => setTimeout(r, 50));
    await reader.cancel(); // client disconnect while the snapshot transaction is open
    release();
    await pending;
    await new Promise((r) => setTimeout(r, 150));
    expect(reads).toBe(0);
  });
});

describe("durable event log over /events", () => {
  it("publish on one instance reaches a stream on another", async () => {
    const a = await testApp();
    const dbB = createDb(a.url);
    const b = await testApp({ db: dbB.db, sse: { pollMs: 50 } });
    try {
      const res = await b.app.request("/events?sessionId=s1");
      const reading = readFrames(res, (f) => kinds(f).includes("confirm"), 2000);
      await new Promise((r) => setTimeout(r, 100));
      const p = await (await a.call("POST", "/intents", sendBody, { "x-arcie-session": "s1" })).json();
      const frames = await reading;
      const confirm = islandFrames(frames).find((f) => JSON.parse(f.data!).kind === "confirm");
      expect(confirm).toBeDefined();
      expect(JSON.parse(confirm!.data!)).toMatchObject({ intentId: p.island.intentId });
      expect(confirm!.id).toBeDefined();
    } finally {
      await dbB.close();
    }
  });

  it("publication during initial connection is not lost and arrives exactly once", async () => {
    const { app, call, db, events } = await testApp({ sse: { pollMs: 30 } });
    await call("POST", "/intents", sendBody, { "x-arcie-session": "s1" }); // seq 1: a card that the snapshot also returns
    events.onSnapshotRead = async () => {
      events.onSnapshotRead = undefined;
      await events.append(db, "s1", receiveIsland("0xlive")); // commits while the snapshot transaction is open
    };
    const res = await app.request("/events?sessionId=s1");
    const frames = await readFrames(res, (f) => kinds(f).includes("receive"), 2000);
    await new Promise((r) => setTimeout(r, 0));
    expect(kinds(frames).filter((k) => k === "confirm")).toHaveLength(1);
    expect(kinds(frames).filter((k) => k === "receive")).toHaveLength(1);
    expect(islandFrames(frames).map((f) => f.id)).toEqual(["1", "2"]); // snapshot card carries the snapshot cursor
  });

  it("resume across forced close delivers exactly seq 1..50 in order", async () => {
    const { app, db, events } = await testApp({ sse: { maxMs: 200, pollMs: 20 } });
    const publisher = (async () => {
      for (let i = 1; i <= 50; i++) {
        await events.append(db, "s1", receiveIsland(`0x${i}`));
        await new Promise((r) => setTimeout(r, 10));
      }
    })();
    const ids: number[] = [];
    let cursor = "0";
    let sawRetry = false;
    for (let round = 0; round < 20 && ids.length < 50; round++) {
      const res = await app.request("/events?sessionId=s1", { headers: { "last-event-id": cursor } });
      const frames = await readFrames(res, () => false, 3000); // read until the server closes the stream
      sawRetry ||= frames.some((f) => f.raw.includes("retry: 1000"));
      for (const f of islandFrames(frames)) ids.push(Number(f.id));
      cursor = String(ids.at(-1) ?? cursor);
    }
    await publisher;
    expect(sawRetry).toBe(true);
    expect(ids).toEqual(Array.from({ length: 50 }, (_, i) => i + 1));
  });

  it("a stale cursor gets the snapshot; a retained cursor skips it", async () => {
    const { app, call, db, events } = await testApp({ sse: { pollMs: 30 } });
    const p = await (await call("POST", "/intents", sendBody, { "x-arcie-session": "s1" })).json(); // seq 1
    await events.append(db, "s1", receiveIsland("0x2")); // seq 2
    await events.append(db, "s1", receiveIsland("0x3")); // seq 3
    await db.delete(sessionEvents).where(lt(sessionEvents.seq, 3)); // retention dropped 1 and 2

    const stale = await app.request("/events?sessionId=s1", { headers: { "last-event-id": "1" } });
    const staleFrames = await readFrames(stale, (f) => islandFrames(f).length >= 1, 1500);
    expect(JSON.parse(islandFrames(staleFrames)[0]!.data!)).toMatchObject({ kind: "confirm", intentId: p.island.intentId });
    expect(islandFrames(staleFrames)[0]!.id).toBe("3");

    const fresh = await app.request("/events?sessionId=s1", { headers: { "last-event-id": "2" } });
    const freshFrames = await readFrames(fresh, (f) => islandFrames(f).length >= 1, 1500);
    expect(kinds(freshFrames)).toEqual(["receive"]); // seq 3 only: no snapshot card
    expect(islandFrames(freshFrames)[0]!.id).toBe("3");
  });

  it("a first connect without Last-Event-ID still gets a cursor to resume from", async () => {
    const { app, db, events } = await testApp({ sse: { maxMs: 150, pollMs: 20 } });
    const first = await readFrames(await app.request("/events?sessionId=s1"), () => false, 3000); // idle session, no header
    const cursor = first.map((f) => f.id).filter((id) => id !== undefined).at(-1);
    expect(cursor).toBeDefined();
    expect(first.every((f) => f.event !== "island")).toBe(true); // the cursor frame must not trigger the island listener
    await events.append(db, "s1", receiveIsland("0xwindow")); // lands between close and reconnect
    const second = await readFrames(await app.request("/events?sessionId=s1", { headers: { "last-event-id": cursor! } }), (f) => kinds(f).includes("receive"), 1500);
    expect(kinds(second)).toEqual(["receive"]);
  });

  it("sends keep-alive pings between events", async () => {
    const { app } = await testApp({ sse: { pollMs: 20, pingMs: 60 } });
    const frames = await readFrames(await app.request("/events?sessionId=s1"), (f) => f.some((x) => x.event === "ping"), 1500);
    expect(frames.some((f) => f.event === "ping")).toBe(true);
  });
});

it("closes during a full burst and resumes at the last delivered event", async () => {
  const { app, db, events } = await testApp({ sse: { maxMs: 100, pollMs: 10 } });
  await db.transaction(async (tx) => {
    for (let i = 0; i < 110; i++) await events.append(tx, "burst", receiveIsland("test"));
  });
  const read = (cursor: string) => app.request("/events?sessionId=burst", { headers: { "last-event-id": cursor } });
  const stream = await read("0");
  const slow = new Response(stream.body!.pipeThrough(new TransformStream({
    async transform(chunk, out) {
      await new Promise((resolve) => setTimeout(resolve, 5));
      out.enqueue(chunk);
    },
  })));
  const first = await readFrames(slow, () => false, 2000);
  const ids = islandFrames(first).map((f) => Number(f.id));
  expect(ids.length).toBeGreaterThan(0);
  expect(ids.length).toBeLessThan(100);
  expect(first.at(-1)?.raw).toContain("retry: 1000");
  const second = await readFrames(await read(String(ids.at(-1) ?? 0)), () => false, 2000);
  expect([...ids, ...islandFrames(second).map((f) => Number(f.id))]).toEqual(Array.from({ length: 110 }, (_, i) => i + 1));
});
