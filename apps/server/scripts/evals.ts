/**
 * pnpm evals: real OpenAI model + harness on FakeAppKit. Checks the FIRST tool the model calls for each utterance.
 * Exits non-zero below 90%. Never tune the prompt by weakening a harness rule.
 */
import { FakeAppKit, type WalletRef } from "@arcie/appkit";
import { createDb, seed, wallets } from "@arcie/db";
import { createHarness, DbPolicyProvider, EventLog, type HarnessCtx, type ToolResult } from "@arcie/harness";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import OpenAI from "openai";
import { runAgentTurn, type ChatClient } from "../src/llm/loop.js";
import { need } from "./lib.js";

type Case = {
  say: string;
  expectTool: string | string[] | null;
  expectArgs?: Record<string, unknown>;
  expectError?: string;
  note?: string;
  neverTool?: string;
};

const cases = JSON.parse(readFileSync(new URL("../evals/utterances.json", import.meta.url), "utf8")) as Case[];
const openai = new OpenAI({ apiKey: need("OPENAI_API_KEY") }) as unknown as ChatClient;
const model = need("OPENAI_MODEL");
const reasoningEffort = process.env.OPENAI_REASONING_EFFORT || undefined;
/** Scratch Postgres (migrated). Each case gets its own user and session, so parallel cases never touch each other. */
const { db, close } = createDb(need("EVALS_DATABASE_URL"), { max: 4 });
const W: WalletRef = { chain: "Arc_Testnet", address: "0x000000000000000000000000000000000000dEaD", circleWalletId: "w1" };

async function runCase(c: Case) {
  const userId = `eval-${randomUUID()}`;
  await seed(db, { userId });
  await db.insert(wallets).values({ id: `w-${userId}`, userId, chain: "Arc_Testnet", circleWalletId: "w1", address: W.address, accountType: "EOA" });
  const kit = new FakeAppKit();
  kit.setBalance(W, "USDC", "100");
  kit.setBalance(W, "EURC", "20");
  const h = createHarness({ db, kit, policy: new DbPolicyProvider(db), events: new EventLog(db) });
  const calls: { name: string; args: Record<string, unknown>; result: ToolResult }[] = [];
  const recording = {
    tools: h.tools,
    runTool: async (ctx: HarnessCtx, name: string, args: unknown) => {
      const result = await h.runTool(ctx, name, args);
      calls.push({ name, args: args as Record<string, unknown>, result });
      return result;
    },
  };
  const ctx: HarnessCtx = { userId, sessionId: `eval:${userId}`, channel: "voice", userTurn: 1, now: () => new Date(), runId: "eval" };
  let reply = "";
  for await (const s of runAgentTurn({ openai, model, reasoningEffort, harness: recording }, ctx, [{ role: "user", content: c.say }])) reply += s;

  const first = calls[0];
  const problems: string[] = [];
  const expected: (string | null)[] = c.expectTool === null ? [null] : Array.isArray(c.expectTool) ? c.expectTool : [c.expectTool];
  if (!expected.includes(first?.name ?? null)) problems.push(`first tool ${first?.name ?? "none"}, expected ${expected.join("|")}`);
  for (const [k, v] of Object.entries(first ? (c.expectArgs ?? {}) : {})) {
    const got = first?.args?.[k];
    const norm = (x: unknown) => (typeof x === "string" ? x.toLowerCase().replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "") : x);
    if (norm(got) !== norm(v)) problems.push(`${k}=${JSON.stringify(got)}, expected ${JSON.stringify(v)}`);
  }
  if (c.expectError && first && (first.result.data as { error?: string } | undefined)?.error !== c.expectError) {
    problems.push(`expected harness error ${c.expectError}, got ${JSON.stringify(first?.result.data)}`);
  }
  if (c.neverTool && calls.some((x) => x.name === c.neverTool)) problems.push(`called ${c.neverTool}`);
  return { c, ok: problems.length === 0, problems, tools: calls.map((x) => x.name), reply };
}

const results = [];
for (let i = 0; i < cases.length; i += 4) {
  results.push(...(await Promise.all(cases.slice(i, i + 4).map(runCase))));
}
for (const r of results) {
  console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.c.say.padEnd(42)} → ${r.tools.join(" → ") || "(no tool)"}${r.ok ? "" : `   [${r.problems.join("; ")}]`}`);
}
const passed = results.filter((r) => r.ok).length;
const pct = Math.round((passed / results.length) * 100);
console.log(`\n${passed}/${results.length} passed (${pct}%) with ${model}`);
process.exitCode = pct >= 90 ? 0 : 1;
await close();
