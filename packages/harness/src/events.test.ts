import { ArcieError, type IslandPayload, type StepsIsland } from "@arcie/core";
import { audit as auditTable, createDb, seed } from "@arcie/db";
import { describe, expect, it } from "vitest";
import { audit } from "./audit.js";
import type { HarnessCtx } from "./context.js";
import { EventBus, StepTracker } from "./events.js";

const ctx: HarnessCtx = { userId: "demo", sessionId: "s1", channel: "voice", userTurn: 1, now: () => new Date(), runId: "run-1" };
const receive: IslandPayload = { kind: "receive", address: "0x1", chain: "Arc_Testnet", tokens: ["USDC"] };

describe("EventBus", () => {
  it("delivers islands only to subscribers of the same session", () => {
    const bus = new EventBus();
    const s1: IslandPayload[] = [];
    const s2: IslandPayload[] = [];
    bus.subscribe("s1", (i) => s1.push(i));
    bus.subscribe("s2", (i) => s2.push(i));
    bus.publish("s1", receive);
    expect(s1).toEqual([receive]);
    expect(s2).toEqual([]);
  });

  it("stops delivering after unsubscribe", () => {
    const bus = new EventBus();
    const got: IslandPayload[] = [];
    const off = bus.subscribe("s1", (i) => got.push(i));
    off();
    bus.publish("s1", receive);
    expect(got).toEqual([]);
  });
});

describe("StepTracker", () => {
  it("publishes the full steps island on every change, keeping failures visible", () => {
    const bus = new EventBus();
    const seen: StepsIsland[] = [];
    bus.subscribe("s1", (i) => i.kind === "steps" && seen.push(i));
    const t = new StepTracker(bus, ctx);

    const a = t.start("Checking your balance");
    t.done(a);
    t.start("Getting a swap quote");
    const c = t.start("Swapping");
    t.fail(c, new ArcieError("SLIPPAGE_EXCEEDED"));

    const last = seen.at(-1)!;
    expect(last.runId).toBe("run-1");
    expect(last.steps.map((s) => s.status)).toEqual(["done", "running", "failed"]);
    expect(last.steps[2]!.error).toBe(new ArcieError("SLIPPAGE_EXCEEDED").spoken);
    expect(last.elapsedMs).toBeGreaterThanOrEqual(0);
    expect(seen).toHaveLength(5);
  });
});

describe("audit", () => {
  it("writes a row with user, session, intent and payload", async () => {
    const db = createDb(":memory:");
    await seed(db, { userId: "demo" });
    audit(db, ctx, "tool.call", { name: "get_balances" }, "intent-1");
    expect(db.select().from(auditTable).all()).toMatchObject([
      { userId: "demo", sessionId: "s1", intentId: "intent-1", type: "tool.call", payload: { name: "get_balances" } },
    ]);
  });
});
