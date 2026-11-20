import { ArcieError, type ChainId, type TokenSymbol } from "@arcie/core";
import { formatUnits } from "viem";
import { getChain } from "./chains.js";

type RateTable = Readonly<Record<string, Readonly<Record<string, { readonly priceUSD?: string }>>>>;

/** App Kit returns rates keyed by chain, then lowercase token address (verified live on Arc Testnet). */
export function pickUsdRates(rates: RateTable, chain: ChainId, tokens: TokenSymbol[]): Record<TokenSymbol, number> {
  const byAddress = new Map<string, number>();
  for (const [addr, r] of Object.entries(rates[chain] ?? {})) {
    if (r?.priceUSD !== undefined) byAddress.set(addr.toLowerCase(), Number(r.priceUSD));
  }
  const registry = getChain(chain).tokens;
  const out = {} as Record<TokenSymbol, number>;
  for (const t of tokens) {
    const price = byAddress.get(registry[t].address.toLowerCase());
    if (price === undefined || Number.isNaN(price)) {
      throw new ArcieError("CIRCLE_API_ERROR", { detail: { missingRate: t, chain } });
    }
    out[t] = price;
  }
  return out;
}

/** EstimatedGas.fee is in native base units (18 decimals for USDC-as-gas on Arc). */
export function nativeFeeToGasToken(fee: string | null | undefined, chain: ChainId): string | null {
  if (fee == null) return null;
  return formatUnits(BigInt(fee), getChain(chain).viemChain.nativeCurrency.decimals);
}

const SWAP_FEE_LABELS: Record<string, string> = { provider: "Swap provider fee", gas: "Network fee", kit: "App fee" };

export function swapFeeLabel(type: string | undefined): string {
  return (type && SWAP_FEE_LABELS[type]) ?? "Swap fee";
}
