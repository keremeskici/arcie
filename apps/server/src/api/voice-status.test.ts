import type { HarnessCtx } from "@arcie/harness";
import { expect, it } from "vitest";
import { testApp } from "../testkit.js";

it("refreshes a pending swap from a voice status check without executing it again", async () => {
  const { bus, call, harness, kit } = await testApp();
  const ctx: HarnessCtx = {
    userId: "demo", sessionId: "voice-swap", channel: "voice", userTurn: 1, runId: "r1", now: () => new Date(),
  };
  const staged = await harness.runTool(ctx, "propose_swap", { tokenIn: "USDC", tokenOut: "EURC", amountIn: "5" });
  expect(staged.island?.kind).toBe("confirm");
  if (staged.island?.kind !== "confirm") return;
  const { intentId } = staged.island;
  kit.setPendingNext();
  expect((await harness.confirm({ ...ctx, userTurn: 2 }, intentId, "voice")).status).toBe("executing");
  const hash = harness.intents.get(intentId)?.txHash;
  expect(hash).toBeTruthy();
  if (!hash) return;

  expect((await harness.runTool(ctx, "get_intent", { kind: "swap" })).summary).toBe("Your swap is still processing.");
  kit.settle(hash);
  const receipts: string[] = [];
  const unsubscribe = bus.subscribe(ctx.sessionId, (island) => {
    if (island.kind === "receipt") receipts.push(island.intentId);
  });
  const [voice, screen] = await Promise.all([
    harness.runTool(ctx, "get_intent", { kind: "swap" }),
    call("GET", `/intents/${intentId}`, undefined, { "x-arcie-session": ctx.sessionId }),
  ]);
  unsubscribe();

  expect(voice).toMatchObject({ summary: "Your swap completed.", data: { status: "succeeded" } });
  expect(await screen.json()).toMatchObject({ status: "succeeded" });
  expect(receipts).toEqual([intentId]);
  expect(kit.calls.map((entry) => entry.method)).toEqual(["swap"]);
});
