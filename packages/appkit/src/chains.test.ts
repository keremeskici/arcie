import { describe, expect, it } from "vitest";
import { HOME_CHAIN, enabledChains, getChain } from "./chains.js";

describe("chain registry", () => {
  it("enables only Arc Testnet as the home chain", () => {
    expect(HOME_CHAIN).toBe("Arc_Testnet");
    expect(enabledChains().map((c) => c.id)).toEqual(["Arc_Testnet"]);
  });

  it("allows only USDC, EURC and cirBTC for swaps on Arc", () => {
    expect(getChain("Arc_Testnet").capabilities.swap).toEqual(["USDC", "EURC", "cirBTC"]);
  });

  it("pays gas in USDC on Arc", () => {
    expect(getChain("Arc_Testnet").gasToken).toBe("USDC");
  });

  it("has checksummed token addresses and the right decimals", () => {
    const { tokens } = getChain("Arc_Testnet");
    for (const t of Object.values(tokens)) expect(t.address).toMatch(/^0x[0-9a-fA-F]{40}$/);
    expect(tokens.USDC.decimals).toBe(6);
    expect(tokens.EURC.decimals).toBe(6);
    expect(tokens.cirBTC.decimals).toBe(8);
  });

  it("builds explorer links for a tx hash", () => {
    expect(getChain("Arc_Testnet").explorerTx("0xabc")).toBe("https://testnet.arcscan.app/tx/0xabc");
  });
});
