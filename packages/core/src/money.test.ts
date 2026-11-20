import { describe, expect, it } from "vitest";
import { ArcieError } from "./errors.js";
import { formatAmount, isValidAmountString, parseAmount } from "./money.js";

describe("parseAmount", () => {
  it("parses whole numbers into base units", () => {
    expect(parseAmount("5", 6)).toBe(5_000_000n);
  });

  it("parses decimals with trailing zeros", () => {
    expect(parseAmount("5.50", 6)).toBe(5_500_000n);
  });

  it.each([".5", "05", "5,00", "-1", "0", "0.00", "1.1234567", "five", "", " 5", "$5"])(
    "rejects %j with INVALID_AMOUNT",
    (input) => {
      let caught: unknown;
      try {
        parseAmount(input, 6);
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(ArcieError);
      expect((caught as ArcieError).code).toBe("INVALID_AMOUNT");
    },
  );
});

describe("isValidAmountString", () => {
  it("accepts a positive decimal within the token's precision", () => {
    expect(isValidAmountString("0.5", 6)).toBe(true);
  });

  it("rejects more decimals than the token supports", () => {
    expect(isValidAmountString("0.1234567", 6)).toBe(false);
  });
});

describe("formatAmount", () => {
  it("formats base units and trims trailing zeros", () => {
    expect(formatAmount(4_610_000n, 6)).toBe("4.61");
  });

  it("formats whole amounts without a decimal point", () => {
    expect(formatAmount(5_000_000n, 6)).toBe("5");
  });
});
