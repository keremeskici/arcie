import { ArcieError } from "@arcie/core";
import { KitError } from "@circle-fin/app-kit";
import { describe, expect, it } from "vitest";
import { mapKitError } from "./errors.js";

type KitType = ConstructorParameters<typeof KitError>[0]["type"];

function kitError(type: KitType, name: string, message = name, code = 1000) {
  return new KitError({ code, name, type, recoverability: "FATAL", message });
}

describe("mapKitError", () => {
  it("maps an INPUT error about insufficient funds to INSUFFICIENT_BALANCE", () => {
    expect(mapKitError(kitError("INPUT", "INPUT_SOMETHING", "insufficient funds for transfer")).code).toBe(
      "INSUFFICIENT_BALANCE",
    );
  });

  it("maps BALANCE errors to INSUFFICIENT_BALANCE", () => {
    expect(mapKitError(kitError("BALANCE", "BALANCE_INSUFFICIENT_TOKEN")).code).toBe("INSUFFICIENT_BALANCE");
  });

  it.each(["RATE_LIMIT", "NETWORK", "RPC"] as const)("maps %s errors to RPC_UNAVAILABLE", (type) => {
    expect(mapKitError(kitError(type, `${type}_X`)).code).toBe("RPC_UNAVAILABLE");
  });

  it("maps SERVICE errors to CIRCLE_API_ERROR", () => {
    expect(mapKitError(kitError("SERVICE", "SERVICE_DOWN")).code).toBe("CIRCLE_API_ERROR");
  });

  it("maps slippage and stop-limit failures to SLIPPAGE_EXCEEDED", () => {
    expect(mapKitError(kitError("INPUT", "INPUT_SLIPPAGE_CONSTRAINT_NOT_MET")).code).toBe("SLIPPAGE_EXCEEDED");
    expect(mapKitError(new Error("stop limit not reached")).code).toBe("SLIPPAGE_EXCEEDED");
  });

  it("maps a too-small swap amount to INVALID_AMOUNT with a specific spoken reason", () => {
    const err = mapKitError(kitError("INPUT", "INPUT_INSUFFICIENT_SWAP_AMOUNT"));
    expect(err.code).toBe("INVALID_AMOUNT");
    expect(err.spoken).toMatch(/too small/i);
  });

  it("maps LIQUIDITY errors to SLIPPAGE_EXCEEDED with a liquidity reason", () => {
    const err = mapKitError(kitError("LIQUIDITY", "LIQUIDITY_INSUFFICIENT"));
    expect(err.code).toBe("SLIPPAGE_EXCEEDED");
    expect(err.spoken).toMatch(/liquidity/i);
  });

  it("keeps an unknown error as UNKNOWN and preserves the original in detail", () => {
    const original = new Error("kaboom");
    const err = mapKitError(original);
    expect(err.code).toBe("UNKNOWN");
    expect(err.detail).toBe(original);
  });

  it("passes ArcieError through unchanged", () => {
    const e = new ArcieError("VAULT_UNAVAILABLE");
    expect(mapKitError(e)).toBe(e);
  });
});
