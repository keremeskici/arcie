import { FakeAppKit } from "@arcie/appkit";
import type { IslandPayload, OnrampIsland, ReceiveIsland } from "@arcie/core";
import { audit as auditTable, intents, seed, wallets } from "@arcie/db";
import { createTestDb } from "@arcie/db/testing";
import { describe, expect, it } from "vitest";
import type { HarnessCtx } from "./context.js";
import { EventBus } from "./events.js";
import { createHarness } from "./harness.js";
import { DbPolicyProvider } from "./policy/db-provider.js";

const ADDRESS = "0x000000000000000000000000000000000000dEaD";

async function setup() {
  const { db } = await createTestDb();
  await seed(db, { userId: "demo" });
  await db.insert(wallets).values({ id: "w1", userId: "demo", chain: "Arc_Testnet", circleWalletId: "w1", address: ADDRESS, accountType: "EOA" });
  const kit = new FakeAppKit();
  const bus = new EventBus();
  const islands: IslandPayload[] = [];
  bus.subscribe("s1", (i) => islands.push(i));
  const h = createHarness({ db, kit, policy: new DbPolicyProvider(db), bus });
  const ctx: HarnessCtx = { userId: "demo", sessionId: "s1", channel: "voice", userTurn: 1, now: () => new Date(), runId: "r1" };
  return { db, kit, h, ctx, islands };
}

describe("start_onramp", () => {
  it("opens checkout through the voice event stream without asking for an amount", async () => {
    const { h, ctx, db, islands } = await setup();
    const result = await h.runTool(ctx, "start_onramp", {});
    expect(islands.find((i) => i.kind === "onramp")).toEqual(result.island);
    expect(result.island).toMatchObject({ environment: "sandbox", token: "USDC" });
    expect(result.island).not.toHaveProperty("amount");
    expect(await db.select().from(intents)).toHaveLength(0);
    expect(JSON.stringify(result.data)).not.toContain((result.island as OnrampIsland).sessionToken);
  });
  it("returns an onramp island for the user's wallet without creating an intent", async () => {
    const { h, ctx, db, kit } = await setup();
    const r = await h.runTool(ctx, "start_onramp", { amount: "50" });
    const island = r.island as OnrampIsland;
    expect(island.kind).toBe("onramp");
    expect(island.sessionToken).toMatch(/^fake-session-/);
    expect(island).toMatchObject({ sessionId: expect.any(String), expiresAt: expect.any(String), widgetUrl: expect.stringContaining("https://onramp-sandbox.arc.io/"), environment: "sandbox" });
    expect(island.destinationAddress).toBe(ADDRESS);
    expect(island.token).toBe("USDC");
    expect(island.amount).toBe("50");
    expect(r.summary).toBe("I've opened the add-money screen. Complete your deposit there.");
    expect(await db.select().from(intents)).toHaveLength(0);
    expect(kit.calls.find((c) => c.method === "createOnrampSession")?.params).toMatchObject({ appUserId: "demo", destinationAddress: ADDRESS });
  });

  it("rejects a non-numeric amount", async () => {
    const { h, ctx } = await setup();
    expect((await h.runTool(ctx, "start_onramp", { amount: "fifty" })).data).toMatchObject({ error: "INVALID_AMOUNT" });
  });
});

describe("recordOnrampEvent", () => {
  it("refreshes balances after sandbox submission without recording a settled deposit", async () => {
    const { h, ctx, db, islands } = await setup();
    await h.recordOnrampEvent(ctx, { type: "submitted", payload: { settlementExpected: false } });
    expect((await db.select().from(auditTable)).map((a) => a.type)).not.toContain("onramp.settled");
    expect(islands.some((i) => i.kind === "balances")).toBe(true);
  });
  it("audits the event and publishes fresh balances when settled", async () => {
    const { h, ctx, db, islands } = await setup();
    await h.recordOnrampEvent(ctx, { type: "settled", payload: { amount: "50" } });
    expect((await db.select().from(auditTable)).map((a) => a.type)).toContain("onramp.settled");
    expect(islands.some((i) => i.kind === "balances")).toBe(true);
  });
});

describe("get_receive_info", () => {
  it("puts the address on screen without reading it aloud", async () => {
    const { h, ctx } = await setup();
    const r = await h.runTool(ctx, "get_receive_info", {});
    const island = r.island as ReceiveIsland;
    expect(island).toEqual({ kind: "receive", address: ADDRESS, chain: "Arc_Testnet", tokens: ["USDC", "EURC", "cirBTC"] });
    expect(r.summary).not.toContain("0x");
    expect(r.summary).toBe("I've put your receive details on screen.");
  });
});
