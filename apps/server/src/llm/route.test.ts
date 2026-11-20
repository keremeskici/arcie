import { seed, sessions, type Db } from "@arcie/db";
import { createTestDb } from "@arcie/db/testing";
import type { HarnessCtx } from "@arcie/harness";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { chatRoutes, type AgentFn } from "./route.js";

let db: Db;
let seen: { ctx: HarnessCtx; signal: AbortSignal | undefined }[];

const echoAgent: AgentFn = async function* (ctx, _messages, signal) {
  seen.push({ ctx, signal });
  yield "Hello ";
  yield "there.";
};

beforeEach(async () => {
  db = (await createTestDb()).db;
  await seed(db, { userId: "demo" });
  await seed(db, { userId: "kerem" });
  seen = [];
});

const post = (app: ReturnType<typeof chatRoutes>, body: object, headers: Record<string, string> = {}) =>
  app.request("/v1/chat/completions", { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });

const user = (n: number) => Array.from({ length: n }, (_, i) => ({ role: "user", content: `msg ${i}` }));

describe("POST /v1/chat/completions", () => {
  it("streams OpenAI chat.completion.chunk events and ends with [DONE]", async () => {
    const app = chatRoutes({ db, agent: echoAgent, demoUserId: "demo", model: "gpt-test" });
    const res = await post(app, { model: "x", stream: true, messages: user(1) });
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    const lines = (await res.text()).split("\n").filter((l) => l.startsWith("data: "));
    expect(lines.at(-1)).toBe("data: [DONE]");
    const chunks = lines.slice(0, -1).map((l) => JSON.parse(l.slice(6)));
    for (const c of chunks) expect(c.object).toBe("chat.completion.chunk");
    expect(chunks.map((c) => c.choices[0].delta.content ?? "").join("")).toBe("Hello there.");
    expect(chunks.at(-1).choices[0].finish_reason).toBe("stop");
  });

  it("returns a single chat.completion when not streaming", async () => {
    const app = chatRoutes({ db, agent: echoAgent, demoUserId: "demo", model: "gpt-test" });
    const body = await (await post(app, { model: "x", messages: user(1) })).json();
    expect(body).toMatchObject({ object: "chat.completion", choices: [{ message: { role: "assistant", content: "Hello there." }, finish_reason: "stop" }] });
  });

  it("counts user turns and never lowers the stored count on a replayed request", async () => {
    const app = chatRoutes({ db, agent: echoAgent, demoUserId: "demo", model: "m" });
    await (await post(app, { messages: user(3), session_id: "s1" })).text();
    await (await post(app, { messages: user(2), session_id: "s1" })).text();
    expect((await db.select().from(sessions).where(eq(sessions.id, "s1")).limit(1))[0]?.userTurn).toBe(3);
    expect(seen.map((s) => s.ctx.userTurn)).toEqual([3, 3]);
  });

  it("identifies the user from elevenlabs_extra_body before the demo user", async () => {
    const app = chatRoutes({ db, agent: echoAgent, demoUserId: "demo", model: "m" });
    await (await post(app, { messages: user(1), elevenlabs_extra_body: { user_id: "kerem", session_id: "el-1" } })).text();
    expect(seen[0]!.ctx).toMatchObject({ userId: "kerem", sessionId: "el-1", channel: "voice" });
  });

  it("falls back to header then demo user, with a default session per user", async () => {
    const app = chatRoutes({ db, agent: echoAgent, demoUserId: "demo", model: "m" });
    await (await post(app, { messages: user(1) }, { "x-arcie-user": "kerem" })).text();
    await (await post(app, { messages: user(1) })).text();
    expect(seen.map((s) => [s.ctx.userId, s.ctx.sessionId])).toEqual([["kerem", "default:kerem"], ["demo", "default:demo"]]);
  });

  it("uses the repl channel when the caller says so", async () => {
    const app = chatRoutes({ db, agent: echoAgent, demoUserId: "demo", model: "m" });
    await (await post(app, { messages: user(1), arcie_channel: "repl" })).text();
    expect(seen[0]!.ctx.channel).toBe("repl");
  });

  it("requires the shared secret when one is configured", async () => {
    const app = chatRoutes({ db, agent: echoAgent, demoUserId: "demo", model: "m", llmSecret: "s3cret" });
    expect((await post(app, { messages: user(1) })).status).toBe(401);
    expect((await post(app, { messages: user(1) }, { authorization: "Bearer wrong" })).status).toBe(401);
    const ok = await post(app, { messages: user(1) }, { authorization: "Bearer s3cret" });
    expect(ok.status).toBe(200);
  });

  it("rejects an unknown user", async () => {
    const app = chatRoutes({ db, agent: echoAgent, demoUserId: "demo", model: "m" });
    expect((await post(app, { messages: user(1), user_id: "nobody" })).status).toBe(404);
  });

  it("aborts the previous in-flight turn when a new request arrives for the same session", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const slowAgent: AgentFn = async function* (ctx, _m, signal) {
      seen.push({ ctx, signal });
      if (seen.length === 1) {
        yield "first ";
        await Promise.race([gate, new Promise((r) => signal?.addEventListener("abort", r))]);
        return;
      }
      yield "second";
    };
    const app = chatRoutes({ db, agent: slowAgent, demoUserId: "demo", model: "m" });
    const first = post(app, { stream: true, messages: user(1), session_id: "s9" });
    await new Promise((r) => setTimeout(r, 20));
    const second = await post(app, { stream: true, messages: user(2), session_id: "s9" });
    await second.text();
    expect(seen[0]!.signal?.aborted).toBe(true);
    release();
    await (await first).text();
  });
});
