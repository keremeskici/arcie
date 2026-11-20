import { ArcieError } from "@arcie/core";
import { describe, expect, it } from "vitest";
import { nativeFeeToGasToken, pickUsdRates, swapFeeLabel } from "./normalize.js";

const RATES = {
  rates: {
    Arc_Testnet: {
      "0x3600000000000000000000000000000000000000": { priceUSD: "1.0010571414", fetchedAt: 1, decimals: 6 },
      "0x89b50855aa3be2f677cd6303cec089b5f319d72a": { priceUSD: "1.113717004", fetchedAt: 1, decimals: 6 },
    },
  },
};

describe("pickUsdRates", () => {
  it("looks prices up by the registry token address, case-insensitively", () => {
    expect(pickUsdRates(RATES.rates, "Arc_Testnet", ["USDC", "EURC"])).toEqual({ USDC: 1.0010571414, EURC: 1.113717004 });
  });

  it("throws CIRCLE_API_ERROR naming the token when a price is missing", () => {
    let err: unknown;
    try {
      pickUsdRates(RATES.rates, "Arc_Testnet", ["cirBTC"]);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(ArcieError);
    expect((err as ArcieError).code).toBe("CIRCLE_API_ERROR");
    expect((err as ArcieError).detail).toMatchObject({ missingRate: "cirBTC" });
  });
});

describe("nativeFeeToGasToken", () => {
  it("converts an 18-decimal native fee into a human USDC amount", () => {
    expect(nativeFeeToGasToken("5276133845750000", "Arc_Testnet")).toBe("0.00527613384575");
  });

  it("keeps null when the provider could not estimate", () => {
    expect(nativeFeeToGasToken(null, "Arc_Testnet")).toBeNull();
  });
});

describe("swapFeeLabel", () => {
  it("names provider and gas fees in plain words", () => {
    expect(swapFeeLabel("provider")).toBe("Swap provider fee");
    expect(swapFeeLabel("gas")).toBe("Network fee");
    expect(swapFeeLabel("kit")).toBe("App fee");
    expect(swapFeeLabel(undefined)).toBe("Swap fee");
  });
});
