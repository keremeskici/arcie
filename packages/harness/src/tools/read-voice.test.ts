import { FakeAppKit, type WalletRef } from "@arcie/appkit";
import type { ActionKind, IslandPayload } from "@arcie/core";
import { audit, contacts, seed, wallets, type IntentStatus } from "@arcie/db";
import { createTestDb } from "@arcie/db/testing";
import { expect, it } from "vitest";
import type { HarnessCtx } from "../context.js";
import { EventLog } from "../events.js";
import { createHarness } from "../harness.js";
import { DbPolicyProvider } from "../policy/db-provider.js";

const wallet: WalletRef = {
  chain: "Arc_Testnet",
  address: "0x000000000000000000000000000000000000dEaD",
  circleWalletId: "w1",
};
const now = new Date("2026-11-20T10:00:00Z");
const ctx: HarnessCtx = { userId: "demo", sessionId: "voice", runId: "r1", userTurn: 2, channel: "voice", now: () => now };

async function setup() {
  const { db } = await createTestDb();
  await seed(db, { userId: ctx.userId });
  await seed(db, { userId: "other" });
  await db.insert(wallets).values({ id: "w1", userId: ctx.userId, chain: wallet.chain, circleWalletId: "w1", address: wallet.address, accountType: "EOA" });
  const kit = new FakeAppKit();
  kit.setBalance(wallet, "USDC", "100");
  kit.setBalance(wallet, "EURC", "20");
  const events = new EventLog(db);
  const islands = async (): Promise<IslandPayload[]> => (await events.readAfter(ctx.sessionId, 0)).map((event) => event.island);
  const harness = createHarness({ db, kit, events, policy: new DbPolicyProvider(db) });

  function addIntent({ kind = "send", status = "awaiting_confirmation", statusReason, sessionId = ctx.sessionId, userId = ctx.userId, age = 10 }:
    { kind?: ActionKind; status?: IntentStatus; statusReason?: string; sessionId?: string; userId?: string; age?: number } = {}) {
    return harness.intents.create({
      kind, status, statusReason, sessionId, userId, chain: wallet.chain, preview: {}, params: { amount: "5", token: "USDC" },
      usdValue: "5", previewTurn: 1, now: new Date(now.getTime() - age * 1000), ttlSec: 120,
    });
  }

  return { db, kit, islands, harness, addIntent };
}

it("checks a transaction without needing an ID, preferring this conversation and respecting kind and account", async () => {
  const { addIntent, harness } = await setup();
  const send = await addIntent({ age: 20 });
  const newerSend = await addIntent({ sessionId: "elsewhere", status: "succeeded", age: 6 });
  const swap = await addIntent({ sessionId: "elsewhere", kind: "swap", status: "executing", age: 8 });
  const withdrawal = await addIntent({ sessionId: "elsewhere", kind: "earn_withdraw", age: 5 });
  const other = await addIntent({ userId: "other", status: "succeeded", age: 4 });

  expect(await harness.runTool(ctx, "get_intent", {})).toMatchObject({
    summary: "Your send is waiting for your confirmation.", data: { id: send.id, status: "awaiting_confirmation" },
  });
  expect(await harness.runTool(ctx, "get_intent", { kind: "swap" })).toMatchObject({
    summary: "Your swap is still processing.", data: { id: swap.id, status: "executing" },
  });
  expect(await harness.runTool(ctx, "get_intent", { id: newerSend.id })).toMatchObject({
    summary: "Your send completed.", data: { id: newerSend.id, status: "succeeded" },
  });
  expect(await harness.runTool(ctx, "get_intent", { kind: "earn_withdraw" })).toMatchObject({
    summary: "Your savings withdrawal needs confirmation where you started it.", data: { id: withdrawal.id, status: "awaiting_confirmation" },
  });
  expect(await harness.runTool(ctx, "get_intent", { id: other.id })).toMatchObject({ data: { error: "NOT_FOUND" } });
  expect(await harness.runTool(ctx, "get_intent", { kind: "earn_deposit" })).toMatchObject({
    summary: "I couldn't find a recent savings deposit.",
  });
});

it("speaks expired, cancelled, and unverified states accurately in status and recent activity", async () => {
  const { addIntent, harness } = await setup();
  const expired = await addIntent({ kind: "swap", age: 120 });
  const cancelled = await addIntent({ kind: "earn_withdraw", status: "cancelled", age: 16 });
  const uncertain = await addIntent({ kind: "send", status: "failed", statusReason: "submission_unknown", age: 5 });

  expect(await harness.runTool(ctx, "get_intent", { id: expired.id })).toMatchObject({
    summary: "Your swap request expired. Ask for a new one.", data: { status: "expired" },
  });
  expect(await harness.runTool(ctx, "get_intent", { id: cancelled.id })).toMatchObject({
    summary: "Your savings withdrawal was cancelled.", data: { status: "cancelled" },
  });
  expect(await harness.runTool(ctx, "get_intent", { id: uncertain.id })).toMatchObject({
    summary: "I couldn't verify your send. Check Activity before trying again.", data: { status: "unverified", statusReason: "submission_unknown" },
  });
  expect(await harness.runTool(ctx, "get_activity", { limit: 2 })).toMatchObject({
    summary: "I couldn't verify your send. Check Activity before trying again.",
    data: { items: [{ intentId: uncertain.id }, { intentId: cancelled.id }] },
  });
});

it("treats a checkout update as activity without claiming money arrived", async () => {
  const { db, addIntent, harness } = await setup();
  await addIntent({ status: "succeeded", age: 40 });
  await db.insert(audit).values({ type: "onramp.settled", userId: ctx.userId, sessionId: ctx.sessionId, payload: {}, createdAt: now.toISOString() });
  await db.insert(audit).values({ type: "onramp.failed", userId: "other", sessionId: "other", payload: {}, createdAt: now.toISOString() });
  expect(await harness.runTool(ctx, "get_activity", { limit: 1 })).toMatchObject({
    summary: "Checkout reported an update. Check your wallet balance for the funds.", data: { items: [{ kind: "onramp", status: "checkout_updated" }] },
  });
});

it("opens contacts and activity only when the voice caller asks to see them", async () => {
  const { harness, islands } = await setup();
  expect(await harness.runTool(ctx, "get_activity", {})).toMatchObject({ summary: "No activity yet." });
  expect(await harness.runTool(ctx, "list_contacts", {})).toMatchObject({ summary: "Your contacts are Alice, Alice Smith and Bob." });
  expect((await islands()).filter((event) => event.kind === "open_screen")).toEqual([]);
  const contacts = await harness.runTool(ctx, "find_contact", { name: "Bob", show: true });
  const activity = await harness.runTool(ctx, "get_activity", { show: true });
  expect(contacts).toMatchObject({ summary: "I've opened your contacts.", island: { kind: "open_screen", screen: "contacts", requestId: expect.any(String) } });
  expect(activity).toMatchObject({ summary: "I've opened your activity.", island: { kind: "open_screen", screen: "activity", requestId: expect.any(String) } });
  expect((await islands()).filter((event) => event.kind === "open_screen")).toEqual([contacts.island, activity.island]);
});

it("offers a concise contact count and gives names when requested", async () => {
  const { db, harness } = await setup();
  await db.insert(contacts).values({ id: "carol", userId: ctx.userId, chain: wallet.chain, address: wallet.address, name: "Carol" });

  expect(await harness.runTool(ctx, "list_contacts", {})).toMatchObject({ summary: "You have four saved contacts." });
  expect(await harness.runTool(ctx, "list_contacts", { names: true })).toMatchObject({ summary: "Your contacts are Alice, Alice Smith, Bob and Carol." });
  expect(await harness.runTool(ctx, "find_contact", { name: "0x0000000000000000000000000000000000000001" })).toEqual({
    summary: "That address isn't in your contacts.", data: { matches: [] },
  });
});

it("gives a plain-language swap estimate without placing or rounding the quote", async () => {
  const { harness, kit } = await setup();
  const quote = await harness.runTool(ctx, "get_swap_quote", { tokenIn: "USDC", tokenOut: "EURC", amountIn: "10" });
  expect(quote).toMatchObject({ summary: "You'd get about 9.2 euros.", data: { estimatedOut: "9.2" } });
  const small = await harness.runTool(ctx, "get_swap_quote", { tokenIn: "USDC", tokenOut: "EURC", amountIn: "0.01" });
  expect(small).toMatchObject({ summary: "You'd get less than 0.01 euros.", data: { estimatedOut: "0.0092" } });
  expect(await harness.intents.listForUser(ctx.userId, 1)).toEqual([]);
  expect(kit.calls).toEqual([]);
});
