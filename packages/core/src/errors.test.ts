import { describe, expect, it } from "vitest";
import { ArcieError, spokenMessage, type ErrorCode } from "./errors.js";

const ALL_CODES: ErrorCode[] = [
  "INSUFFICIENT_BALANCE",
  "SLIPPAGE_EXCEEDED",
  "QUOTE_EXPIRED",
  "VAULT_UNAVAILABLE",
  "POLICY_DENIED",
  "INVALID_RECIPIENT",
  "INVALID_AMOUNT",
  "NOT_FOUND",
  "RPC_UNAVAILABLE",
  "CIRCLE_API_ERROR",
  "ONRAMP_ERROR",
  "UNKNOWN",
];

describe("spokenMessage", () => {
  it("fills balance variables into the insufficient-balance message", () => {
    const msg = spokenMessage("INSUFFICIENT_BALANCE", { have: "3", want: "5", token: "USDC" });
    expect(msg).toContain("3");
    expect(msg).toContain("5");
    expect(msg).toContain("USDC");
  });

  it.each(ALL_CODES)("has a short spoken message for %s", (code) => {
    const msg = spokenMessage(code);
    expect(msg.length).toBeGreaterThan(0);
    expect(msg.split(/\s+/).length).toBeLessThanOrEqual(25);
    expect(msg).not.toMatch(/\{\w+\}/);
  });
});

describe("ArcieError", () => {
  it("carries code, spoken message and detail", () => {
    const err = new ArcieError("NOT_FOUND", { detail: { id: "x" } });
    expect(err).toBeInstanceOf(Error);
    expect(err.code).toBe("NOT_FOUND");
    expect(err.spoken).toBe(spokenMessage("NOT_FOUND"));
    expect(err.detail).toEqual({ id: "x" });
  });

  it("lets callers override the spoken message", () => {
    const err = new ArcieError("INVALID_RECIPIENT", { spoken: "I can't send to ENS names yet." });
    expect(err.spoken).toBe("I can't send to ENS names yet.");
  });
});
