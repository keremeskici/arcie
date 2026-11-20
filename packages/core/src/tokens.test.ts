import { describe, expect, it } from "vitest";
import { money, tokenName } from "./tokens.js";

describe("token display names", () => {
  it("shows people USD, EUR and BTC instead of the onchain symbols", () => {
    expect(tokenName("USDC")).toBe("USD");
    expect(tokenName("EURC")).toBe("EUR");
    expect(tokenName("cirBTC")).toBe("BTC");
  });

  it("leaves unknown symbols as they are", () => {
    expect(tokenName("WETH")).toBe("WETH");
  });

  it("formats an amount with the display name", () => {
    expect(money("5", "USDC")).toBe("5 USD");
    expect(money("0.92", "EURC")).toBe("0.92 EUR");
  });
});
