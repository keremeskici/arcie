export type ChainId = "Arc_Testnet";
export type TokenSymbol = "USDC" | "EURC" | "cirBTC";
export type ActionKind = "send" | "swap" | "earn_deposit" | "earn_withdraw";
export type Channel = "voice" | "screen" | "repl";

/** Spec §8.4 */
export interface AgentLimits {
  maxPerTxUsd: number;
  dailyCapUsd: number;
  allowedActions: ActionKind[];
  allowedTokens: TokenSymbol[];
  maxSlippageBps: number;
  /** A raw address that isn't in contacts must be confirmed on screen. */
  newRecipientRequiresScreen: boolean;
}

export const DEFAULT_LIMITS: AgentLimits = {
  maxPerTxUsd: 50,
  dailyCapUsd: 200,
  allowedActions: ["send", "swap", "earn_deposit", "earn_withdraw"],
  allowedTokens: ["USDC", "EURC", "cirBTC"],
  maxSlippageBps: 100,
  newRecipientRequiresScreen: true,
};
