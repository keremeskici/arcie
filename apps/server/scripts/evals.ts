/**
 * pnpm evals: real OpenAI model + FakeAppKit. Checks spoken replies and multi-turn wallet flows.
 * Passes when core workflows pass, every exposed tool is covered, and at least 90% of cases pass.
 */
import { FakeAppKit, type WalletRef } from "@arcie/appkit";
import type { ErrorCode } from "@arcie/core";
import { createDb, seed, wallets } from "@arcie/db";
import { createHarness, DbPolicyProvider, EventBus, type HarnessCtx, type ToolResult } from "@arcie/harness";
import { readFileSync } from "node:fs";
import OpenAI from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { runAgentTurn, type ChatClient } from "../src/llm/loop.js";
import { need } from "./lib.js";

type Turn = {
  say: string;
  expectTool: string | string[] | null;
  expectArgs?: Record<string, unknown>;
  expectError?: string;
  expectStatus?: string;
  expectEvents?: string[];
  expectWrites?: string[];
  expectReply?: string;
  rejectReply?: string;
  maxReplyWords?: number;
  afterSeconds?: number;
  note?: string;
  neverTool?: string;
};

type Workflow = { name: string; turns: Turn[]; pendingSwap?: boolean; screenOnly?: boolean; failNextWrite?: ErrorCode };
const fixtures = JSON.parse(readFileSync(new URL("../evals/utterances.json", import.meta.url), "utf8")) as (Turn | Workflow)[];
const scenarios = fixtures.map((c) => "turns" in c
  ? { ...c, required: true }
  : { name: c.say, turns: [c], required: !!(c.expectReply || c.maxReplyWords) });
const filter = process.argv.slice(2).join(" ").toLowerCase();
const cases = scenarios.filter((c) => c.name.toLowerCase().includes(filter));
if (!cases.length) throw new Error(`No scenarios matched ${JSON.stringify(filter)}.`);
const openai = new OpenAI({ apiKey: need("OPENAI_API_KEY") }) as unknown as ChatClient;
const model = need("OPENAI_MODEL");
const reasoningEffort = process.env.OPENAI_REASONING_EFFORT || undefined;
const W: WalletRef = { chain: "Arc_Testnet", address: "0x000000000000000000000000000000000000dEaD", circleWalletId: "w1" };

type ToolCall = { name: string; args: Record<string, unknown>; result: ToolResult };

async function runCase(c: (typeof scenarios)[number]) {
  const db = createDb(":memory:");
  await seed(db, { userId: "demo" });
  db.insert(wallets).values({ id: "w1", userId: "demo", chain: "Arc_Testnet", circleWalletId: "w1", address: W.address, accountType: "EOA" }).run();
  const kit = new FakeAppKit();
  kit.setBalance(W, "USDC", "100");
  kit.setBalance(W, "EURC", "20");
  if ("pendingSwap" in c && c.pendingSwap) kit.setPendingNext();
  if ("failNextWrite" in c && c.failNextWrite) kit.failNext(c.failNextWrite);
  const bus = new EventBus();
  const events: string[] = [];
  const unsubscribe = bus.subscribe("eval", (event) => { if (event.kind !== "steps") events.push(event.kind); });
  const confirmChannels = "screenOnly" in c && c.screenOnly ? "screen" : "any";
  const h = createHarness({ db, kit, policy: new DbPolicyProvider(db), bus, confirmChannels });
  const calls: ToolCall[] = [];
  const recording = {
    tools: h.tools,
    runTool: async (ctx: HarnessCtx, name: string, args: unknown) => {
      const result = await h.runTool(ctx, name, args);
      calls.push({ name, args: args as Record<string, unknown>, result });
      return result;
    },
  };
  const messages: ChatCompletionMessageParam[] = [];
  const started = Date.now();
  const results = [];
  try {
    for (const [i, turn] of c.turns.entries()) {
      const userTurn = i + 1;
      const ctx: HarnessCtx = { userId: "demo", sessionId: "eval", channel: "voice", userTurn, now: () => new Date(started + (turn.afterSeconds ?? i) * 1000), runId: `eval-${userTurn}` };
      const previous = { calls: calls.length, events: events.length, writes: kit.calls.length };
      messages.push({ role: "user", content: turn.say });
      let reply = "";
      for await (const chunk of runAgentTurn({ openai, model, reasoningEffort, harness: recording }, ctx, messages)) reply += chunk;
      messages.push({ role: "assistant", content: reply });
      results.push(checkTurn(turn, reply, calls.slice(previous.calls), events.slice(previous.events), kit.calls.slice(previous.writes).map((x) => x.method)));
    }
    return { c, results, ok: results.every((r) => !r.problems.length), availableTools: h.tools.map((tool) => tool.name) };
  } finally {
    unsubscribe();
  }
}

function checkTurn(c: Turn, reply: string, calls: ToolCall[], events: string[], writes: string[]) {
  const first = calls[0];
  const data = first?.result.data as { error?: string; status?: string } | undefined;
  const problems: string[] = [];
  const expected: (string | null)[] = c.expectTool === null ? [null] : Array.isArray(c.expectTool) ? c.expectTool : [c.expectTool];
  if (!expected.includes(first?.name ?? null)) problems.push(`first tool ${first?.name ?? "none"}, expected ${expected.join("|")}`);
  for (const [k, v] of Object.entries(first ? (c.expectArgs ?? {}) : {})) {
    const got = first?.args?.[k];
    const norm = (x: unknown) => (typeof x === "string" ? x.toLowerCase().replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "") : x);
    if (norm(got) !== norm(v)) problems.push(`${k}=${JSON.stringify(got)}, expected ${JSON.stringify(v)}`);
  }
  if (c.expectError && first && data?.error !== c.expectError) {
    problems.push(`expected harness error ${c.expectError}, got ${JSON.stringify(first?.result.data)}`);
  }
  if (c.expectStatus && data?.status !== c.expectStatus) problems.push(`status ${data?.status ?? "missing"}, expected ${c.expectStatus}`);
  if (c.expectEvents && JSON.stringify(events) !== JSON.stringify(c.expectEvents)) problems.push(`screen events [${events}], expected [${c.expectEvents}]`);
  if (c.expectWrites && JSON.stringify(writes) !== JSON.stringify(c.expectWrites)) problems.push(`wallet writes [${writes}], expected [${c.expectWrites}]`);
  if (c.neverTool && calls.some((x) => x.name === c.neverTool)) problems.push(`called ${c.neverTool}`);
  if (!reply.trim()) problems.push("missing reply");
  if (c.expectReply && !new RegExp(c.expectReply, "is").test(reply.trim())) problems.push(`unexpected reply: ${JSON.stringify(reply)}`);
  if ((c.rejectReply && new RegExp(c.rejectReply, "is").test(reply)) || /0x[\da-f]{4,}|fake-session-[\da-f]+|\b[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}\b/i.test(reply)) {
    problems.push(`unexpected spoken detail: ${JSON.stringify(reply)}`);
  }
  if (c.maxReplyWords && reply.trim().split(/\s+/).length > c.maxReplyWords) problems.push(`reply exceeded ${c.maxReplyWords} words: ${JSON.stringify(reply)}`);
  return { c, problems, tools: calls.map((x) => x.name), reply };
}

const results = [];
for (let i = 0; i < cases.length; i += 4) {
  results.push(...(await Promise.all(cases.slice(i, i + 4).map(runCase))));
}
for (const r of results) {
  console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.c.name.padEnd(42)} → ${r.results.map((turn) => turn.tools.join(" → ") || "(no tool)").join(" / ")}`);
  for (const [i, turn] of r.results.entries()) {
    if (!turn.problems.length) continue;
    console.log(`      ${turn.c.say} → ${JSON.stringify(turn.reply)} [${turn.problems.join("; ")}]`);
    if (i > 0) console.log(`      Previous reply: ${JSON.stringify(r.results[i - 1]!.reply)}`);
  }
}
const passed = results.filter((r) => r.ok).length;
const pct = Math.round((passed / results.length) * 100);
const available = results[0]!.availableTools;
const covered = new Set(results.filter((r) => r.ok).flatMap((r) => r.results.flatMap((turn) => turn.tools.slice(0, 1))));
const missing = available.filter((tool) => !covered.has(tool));
console.log(`\n${passed}/${results.length} scenarios passed (${pct}%) with ${model}. Exercised ${available.length - missing.length}/${available.length} tools as the expected first call.`);
if (!filter && missing.length) console.log(`Missing tool coverage: ${missing.join(", ")}`);
const requiredPassed = results.every((r) => !r.c.required || r.ok);
process.exitCode = requiredPassed && (filter ? passed === results.length : pct >= 90 && !missing.length) ? 0 : 1;
