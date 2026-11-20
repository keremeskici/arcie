import { intents } from "@arcie/db";
import type { HarnessCtx } from "@arcie/harness";
import { eq, sql } from "drizzle-orm";
import { expect, it } from "vitest";
import { testApp } from "../testkit.js";

it("refreshes a pending swap from a voice status check without executing it again", async () => {
  const { db, events, call, harness, kit } = await testApp();
  const ctx: HarnessCtx = {
    userId: "demo", sessionId: "voice-swap", channel: "voice", userTurn: 1, runId: "r1", now: () => new Date(),
  };
  const staged = await harness.runTool(ctx, "propose_swap", { tokenIn: "USDC", tokenOut: "EURC", amountIn: "5" });
  expect(staged.island?.kind).toBe("confirm");
  if (staged.island?.kind !== "confirm") return;
  const { intentId } = staged.island;
  kit.setPendingNext();
  expect((await harness.confirm({ ...ctx, userTurn: 2 }, intentId, "voice")).status).toBe("executing");
  const hash = (await harness.intents.get(intentId))?.txHash;
  expect(hash).toBeTruthy();
  if (!hash) return;

  expect((await harness.runTool(ctx, "get_intent", { kind: "swap" })).summary).toBe("Your swap is still processing.");
  kit.settle(hash);
  await db.update(intents).set({ reconcileCheckedAt: sql`clock_timestamp() - interval '11 seconds'` }).where(eq(intents.id, intentId));
  const voice = await harness.runTool(ctx, "get_intent", { kind: "swap" });
  expect(voice).toMatchObject({ summary: "Your swap completed.", data: { status: "succeeded" } });
  const screen = await call("GET", `/intents/${intentId}`, undefined, { "x-arcie-session": ctx.sessionId });
  expect(await screen.json()).toMatchObject({ status: "succeeded" });
  const receipts = (await events.readAfter(ctx.sessionId, 0)).flatMap(({ island }) =>
    island.kind === "receipt" ? [island.intentId] : [],
  );
  expect(receipts).toEqual([intentId]);
  expect(kit.calls.map((entry) => entry.method)).toEqual(["swap"]);
});
