import type { ChainId, TokenSymbol } from "@arcie/core";
import type { Chain } from "viem";
import { arcTestnet } from "viem/chains";

export interface TokenInfo {
  address: `0x${string}`;
  decimals: number;
}

export interface ChainConfig {
  id: ChainId;
  /** Circle Wallets blockchain identifier. */
  circleBlockchain: "ARC-TESTNET";
  enabled: boolean;
  tokens: Record<TokenSymbol, TokenInfo>;
  capabilities: { send: TokenSymbol[]; swap: TokenSymbol[]; earn: TokenSymbol[]; onramp: TokenSymbol[] };
  /** Token used to pay network fees. */
  gasToken: TokenSymbol;
  rpcUrl: string;
  viemChain: Chain;
  explorerTx(hash: string): string;
}

/**
 * Addresses come from App Kit's built-in chain and token registries (@circle-fin/app-kit 1.21.0):
 * ArcTestnet.usdcAddress / eurcAddress and the CIRBTC token locator. Re-checked by the live smoke test (Task 5).
 */
const ARC_TESTNET: ChainConfig = {
  id: "Arc_Testnet",
  circleBlockchain: "ARC-TESTNET",
  enabled: true,
  tokens: {
    USDC: { address: "0x3600000000000000000000000000000000000000", decimals: 6 },
    EURC: { address: "0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a", decimals: 6 },
    cirBTC: { address: "0xf0C4a4CE82A5746AbAAd9425360Ab04fbBA432BF", decimals: 8 },
  },
  capabilities: {
    send: ["USDC", "EURC", "cirBTC"],
    swap: ["USDC", "EURC", "cirBTC"],
    earn: ["USDC", "EURC"],
    onramp: ["USDC", "EURC"],
  },
  gasToken: "USDC",
  rpcUrl: "https://rpc.testnet.arc.io",
  viemChain: arcTestnet,
  explorerTx: (hash) => `https://testnet.arcscan.app/tx/${hash}`,
};

const REGISTRY: Record<ChainId, ChainConfig> = { Arc_Testnet: ARC_TESTNET };

export const HOME_CHAIN: ChainId = "Arc_Testnet";

export function getChain(id: ChainId): ChainConfig {
  return REGISTRY[id];
}

export function enabledChains(): ChainConfig[] {
  return Object.values(REGISTRY).filter((c) => c.enabled);
}
