import { DEFAULT_LIMITS } from "@arcie/core";
import { createDb, limits, seed } from "@arcie/db";
import { describe, expect, it } from "vitest";
import { checkPolicy, type PolicyInput } from "./check.js";
import { DbPolicyProvider } from "./db-provider.js";

function input(over: Partial<PolicyInput> = {}): PolicyInput {
  return {
    action: "send",
    token: "USDC",
    amount: "5",
    usdValue: 5,
    limits: DEFAULT_LIMITS,
    spentTodayUsd: 0,
    balance: "100",
    fee: { amount: "0.01", token: "USDC" },
    decimals: 6,
    ...over,
  };
}

describe("checkPolicy", () => {
  it("allows a normal send and returns the amount unchanged", () => {
    expect(checkPolicy(input())).toEqual({ ok: true, amount: "5", adjustments: [], requireScreen: false });
  });

  it("denies a transaction over the per-transaction limit", () => {
    const r = checkPolicy(input({ amount: "51", usdValue: 51 }));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe("POLICY_DENIED");
      expect(r.reason).toContain("$50 per-transaction limit");
    }
  });

  it("denies when the daily cap would be exceeded", () => {
    const r = checkPolicy(input({ amount: "15", usdValue: 15, spentTodayUsd: 190 }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain("$200 daily");
  });

  it("denies an action that isn't allowed", () => {
    const r = checkPolicy(input({ limits: { ...DEFAULT_LIMITS, allowedActions: ["swap"] } }));
    expect(r).toMatchObject({ ok: false, code: "POLICY_DENIED" });
  });

  it("denies a token that isn't allowed", () => {
    const r = checkPolicy(input({ token: "cirBTC", decimals: 8, limits: { ...DEFAULT_LIMITS, allowedTokens: ["USDC"] } }));
    expect(r).toMatchObject({ ok: false, code: "POLICY_DENIED" });
  });

  it("denies a slippage above the cap", () => {
    const r = checkPolicy(input({ action: "swap", slippageBps: 150 }));
    expect(r).toMatchObject({ ok: false, code: "POLICY_DENIED" });
  });

  it("requires a screen confirmation for a new recipient", () => {
    expect(checkPolicy(input({ recipient: { known: false } }))).toMatchObject({ ok: true, requireScreen: true });
  });

  it("does not require the screen for a known contact", () => {
    expect(checkPolicy(input({ recipient: { known: true } }))).toMatchObject({ ok: true, requireScreen: false });
  });

  it("reports insufficient balance with the amounts", () => {
    const r = checkPolicy(input({ balance: "3", amount: "5" }));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe("INSUFFICIENT_BALANCE");
      expect(r.reason).toContain("3");
      expect(r.reason).toContain("5");
    }
  });

  it("counts the USDC network fee when sending the whole USDC balance without sendAll", () => {
    expect(checkPolicy(input({ balance: "10", amount: "10" }))).toMatchObject({ ok: false, code: "INSUFFICIENT_BALANCE" });
  });

  it("send-all keeps the network fee back and discloses it as an adjustment (Review Focus 4)", () => {
    const r = checkPolicy(input({ balance: "10", amount: "10", sendAll: true, usdValue: 10 }));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.amount).toBe("9.99");
      expect(r.adjustments[0]).toContain("0.01");
      expect(r.adjustments[0]).toContain("network fee");
    }
  });

  it("send-all of a non-gas token sends everything and checks gas separately", () => {
    const r = checkPolicy(input({ token: "EURC", balance: "4", amount: "4", sendAll: true, gasBalance: "1" }));
    expect(r).toMatchObject({ ok: true, amount: "4", adjustments: [] });
  });

  it("denies when the gas token balance can't cover the fee", () => {
    const r = checkPolicy(input({ token: "EURC", balance: "4", amount: "2", gasBalance: "0" }));
    expect(r).toMatchObject({ ok: false, code: "INSUFFICIENT_BALANCE" });
  });
});

describe("DbPolicyProvider", () => {
  it("reads and validates the stored limits", async () => {
    const db = createDb(":memory:");
    await seed(db, { userId: "demo" });
    expect(await new DbPolicyProvider(db).getLimits("demo")).toEqual({ ...DEFAULT_LIMITS, source: "db" });
  });

  it("rejects malformed stored limits", async () => {
    const db = createDb(":memory:");
    await seed(db, { userId: "demo" });
    db.update(limits).set({ json: { maxPerTxUsd: "lots" } as never }).run();
    await expect(new DbPolicyProvider(db).getLimits("demo")).rejects.toThrow();
  });
});
