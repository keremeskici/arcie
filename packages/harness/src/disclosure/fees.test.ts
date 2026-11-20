import { describe, expect, it } from "vitest";
import { feePhrase } from "./prompt.js";

describe("spoken fee units (F14)", () => {
  it("does not add mixed token quantities and call them USDC", () => {
    const spoken = feePhrase([
      { label: "Network", amount: "0.001", token: "USDC" },
      { label: "Swap", amount: "0.001", token: "cirBTC" },
    ]);
    expect(spoken).toBe("fees shown on the card");
  });
  it("preserves the currency of a single-token fee total", () => {
    expect(feePhrase([{ label: "Fee", amount: "0.01", token: "EURC" }])).toBe("fees about 0.01 EUR");
  });
  it("does not invent a currency for an unknown fee token", () => {
    expect(feePhrase([{ label: "Fee", amount: "1", token: null }])).toBe("fees shown on the card");
  });
});
