import type { ChainId, OnrampSession, TokenSymbol } from "@arcie/core";

/** The only surface the harness sees. Real impl: circle.ts. Tests: fake.ts. Errors are always ArcieError. */
export interface WalletRef {
  chain: ChainId;
  address: `0x${string}`;
  circleWalletId: string;
}

export interface Fee {
  label: string;
  /** null when the provider can't estimate it yet (shown as "—"). */
  amount: string | null;
  token: TokenSymbol | null;
}

export interface TxResult {
  txHash: string;
  explorerUrl: string;
  status: "DONE" | "PENDING" | "FAILED";
  amountOut?: string;
}

export interface Vault {
  address: `0x${string}`;
  name: string;
  token: TokenSymbol;
  /** Fraction, e.g. 0.042 for 4.2%. */
  apy: number;
}

export interface Position {
  vaultName: string;
  currentBalance: string;
  apy: number;
  yieldEarned: string | null;
}

export interface SendParams {
  to: `0x${string}`;
  amount: string;
  token: TokenSymbol;
}

export interface SwapParams {
  tokenIn: TokenSymbol;
  tokenOut: TokenSymbol;
  amountIn: string;
  slippageBps: number;
  /** Approved minimum output in human token units; enforced as the SDK stopLimit. */
  minOut?: string;
}

export interface VaultAmount {
  vault: `0x${string}`;
  amount: string;
}

export interface AppKitPort {
  getBalances(w: WalletRef): Promise<{ token: TokenSymbol; amount: string }[]>;
  getUsdRates(chain: ChainId, tokens: TokenSymbol[]): Promise<Record<TokenSymbol, number>>;
  estimateSend(w: WalletRef, p: SendParams): Promise<{ fee: Fee }>;
  send(w: WalletRef, p: SendParams): Promise<TxResult>;
  estimateSwap(w: WalletRef, p: SwapParams): Promise<{ estimatedOut: string; minOut: string; fees: Fee[] }>;
  swap(w: WalletRef, p: SwapParams): Promise<TxResult>;
  /** Read the confirmed Arc receipt without submitting or retrying a transfer. */
  readTransaction(chain: ChainId, txHash: string, timeoutMs: number): Promise<TxResult["status"]>;
  waitForSwap(w: WalletRef, txHash: string, timeoutMs: number): Promise<TxResult>;
  listVaults(chain: ChainId, token?: TokenSymbol): Promise<Vault[]>;
  getDepositQuote(w: WalletRef, p: VaultAmount): Promise<{ vaultName: string; apy: number; fees: Fee[] }>;
  deposit(w: WalletRef, p: VaultAmount): Promise<TxResult>;
  getWithdrawalQuote(w: WalletRef, p: VaultAmount): Promise<{ expectedAmount: string; fees: Fee[] }>;
  withdraw(w: WalletRef, p: VaultAmount): Promise<TxResult>;
  getPosition(w: WalletRef, vault: `0x${string}`): Promise<Position | null>;
  createOnrampSession(p: {
    appUserId: string;
    destinationAddress: `0x${string}`;
    amount?: string;
    token: TokenSymbol;
  }): Promise<OnrampSession>;
}
