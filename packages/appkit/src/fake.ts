import { ArcieError, formatAmount, parseAmount, type ChainId, type ErrorCode, type TokenSymbol } from "@arcie/core";
import { randomBytes } from "node:crypto";
import { getChain } from "./chains.js";
import type { AppKitPort, Fee, Position, SendParams, SwapParams, TxResult, Vault, VaultAmount, WalletRef } from "./port.js";

const FEE = "0.01"; // USDC network fee per write, like gas on Arc
const RATE_SCALE = 1_000_000n;

const DEFAULT_VAULTS: Vault[] = [
  { address: "0x00000000000000000000000000000000000000a1", name: "Fake Steady USDC", token: "USDC", apy: 0.042 },
  { address: "0x00000000000000000000000000000000000000a2", name: "Fake High Yield USDC", token: "USDC", apy: 0.061 },
  { address: "0x00000000000000000000000000000000000000b1", name: "Fake EURC Vault", token: "EURC", apy: 0.031 },
];

const DEFAULT_USD: Record<TokenSymbol, number> = { USDC: 1, EURC: 1.087, cirBTC: 100_000 };

/** In-memory AppKitPort for tests and evals. Amounts are tracked in base units. */
export class FakeAppKit implements AppKitPort {
  private balances = new Map<string, bigint>();
  private positions = new Map<string, bigint>();
  private rates = new Map<string, number>([
    ["USDC>EURC", 0.92],
    ["EURC>USDC", 1.087],
  ]);
  private usd = { ...DEFAULT_USD };
  private failing: ErrorCode | null = null;
  private pendingNext = false;
  private txStatus = new Map<string, TxResult>();
  readonly vaults: Vault[] = [...DEFAULT_VAULTS];
  /** Every write call, in order, for assertions. */
  readonly calls: { method: string; params: unknown }[] = [];

  // ---- knobs ----
  setBalance(w: WalletRef, token: TokenSymbol, amount: string): void {
    this.balances.set(this.key(w, token), this.units(token, amount, true));
  }
  setSwapRate(tokenIn: TokenSymbol, tokenOut: TokenSymbol, rate: number): void {
    this.rates.set(`${tokenIn}>${tokenOut}`, rate);
  }
  setUsdRate(token: TokenSymbol, usd: number): void {
    this.usd[token] = usd;
  }
  /** The next write call (send/swap/deposit/withdraw/onramp) rejects with this code. */
  failNext(code: ErrorCode): void {
    this.failing = code;
  }
  /** The next swap returns PENDING until settle(txHash). */
  setPendingNext(): void {
    this.pendingNext = true;
  }
  settle(txHash: string, status: "DONE" | "FAILED" = "DONE"): void {
    const tx = this.txStatus.get(txHash);
    if (tx) this.txStatus.set(txHash, { ...tx, status });
  }

  // ---- reads ----
  async getBalances(w: WalletRef) {
    const tokens = Object.keys(getChain(w.chain).tokens) as TokenSymbol[];
    return tokens.map((token) => ({ token, amount: this.fmt(token, this.bal(w, token)) }));
  }
  async getUsdRates(_chain: ChainId, tokens: TokenSymbol[]) {
    return Object.fromEntries(tokens.map((t) => [t, this.usd[t]])) as Record<TokenSymbol, number>;
  }
  async estimateSend(_w: WalletRef, _p: SendParams) {
    return { fee: this.fee() };
  }
  async estimateSwap(_w: WalletRef, p: SwapParams) {
    const out = this.convert(p.tokenIn, p.tokenOut, p.amountIn);
    const min = (out * BigInt(10_000 - p.slippageBps)) / 10_000n;
    return { estimatedOut: this.fmt(p.tokenOut, out), minOut: this.fmt(p.tokenOut, min), fees: [this.fee()] };
  }
  async waitForSwap(_w: WalletRef, txHash: string, _timeoutMs: number) {
    const tx = this.txStatus.get(txHash);
    if (!tx) throw new ArcieError("NOT_FOUND", { detail: { txHash } });
    return tx;
  }
  async listVaults(_chain: ChainId, token?: TokenSymbol) {
    return this.vaults.filter((v) => !token || v.token === token);
  }
  async getDepositQuote(_w: WalletRef, p: VaultAmount) {
    const v = this.vault(p.vault);
    return { vaultName: v.name, apy: v.apy, fees: [this.fee()] };
  }
  async getWithdrawalQuote(_w: WalletRef, p: VaultAmount) {
    this.vault(p.vault);
    return { expectedAmount: p.amount, fees: [this.fee()] };
  }
  async getPosition(w: WalletRef, vault: `0x${string}`): Promise<Position | null> {
    const v = this.vault(vault);
    const units = this.positions.get(`${w.address}:${vault}`) ?? 0n;
    if (units === 0n) return null;
    return { vaultName: v.name, currentBalance: this.fmt(v.token, units), apy: v.apy, yieldEarned: "0" };
  }

  // ---- writes ----
  async send(w: WalletRef, p: SendParams) {
    this.write("send", p);
    this.debit(w, p.token, this.units(p.token, p.amount));
    return this.tx(w);
  }
  async swap(w: WalletRef, p: SwapParams) {
    this.write("swap", p);
    const out = this.convert(p.tokenIn, p.tokenOut, p.amountIn);
    if (p.minOut !== undefined && out < this.units(p.tokenOut, p.minOut, true)) throw new ArcieError("SLIPPAGE_EXCEEDED");
    this.debit(w, p.tokenIn, this.units(p.tokenIn, p.amountIn));
    this.credit(w, p.tokenOut, out);
    const pending = this.pendingNext;
    this.pendingNext = false;
    return this.tx(w, pending ? "PENDING" : "DONE", pending ? undefined : this.fmt(p.tokenOut, out));
  }
  async deposit(w: WalletRef, p: VaultAmount) {
    this.write("deposit", p);
    const v = this.vault(p.vault);
    const units = this.units(v.token, p.amount);
    this.debit(w, v.token, units);
    const k = `${w.address}:${p.vault}`;
    this.positions.set(k, (this.positions.get(k) ?? 0n) + units);
    return this.tx(w);
  }
  async withdraw(w: WalletRef, p: VaultAmount) {
    this.write("withdraw", p);
    const v = this.vault(p.vault);
    const units = this.units(v.token, p.amount);
    const k = `${w.address}:${p.vault}`;
    const held = this.positions.get(k) ?? 0n;
    if (units > held) throw new ArcieError("INSUFFICIENT_BALANCE", { detail: { held, units } });
    this.debit(w, "USDC", 0n); // fee only
    this.positions.set(k, held - units);
    this.credit(w, v.token, units);
    return this.tx(w);
  }
  async createOnrampSession(p: { appUserId: string; destinationAddress: `0x${string}`; amount?: string; token: TokenSymbol }) {
    this.write("createOnrampSession", p);
    const sessionToken = `fake-session-${randomBytes(4).toString("hex")}`;
    return { sessionId: sessionToken, sessionToken, widgetUrl: `https://onramp-sandbox.arc.io/?sessionToken=${sessionToken}`, expiresAt: new Date(Date.now() + 30 * 60_000).toISOString(), environment: "sandbox" as const };
  }

  // ---- internals ----
  private write(method: string, params: unknown) {
    this.calls.push({ method, params });
    if (this.failing) {
      const code = this.failing;
      this.failing = null;
      throw new ArcieError(code, { detail: { method } });
    }
  }
  private key(w: WalletRef, token: TokenSymbol) {
    return `${w.address}:${token}`;
  }
  private bal(w: WalletRef, token: TokenSymbol) {
    return this.balances.get(this.key(w, token)) ?? 0n;
  }
  private decimals(token: TokenSymbol) {
    return getChain("Arc_Testnet").tokens[token].decimals;
  }
  private units(token: TokenSymbol, amount: string, allowZero = false) {
    if (allowZero && /^0(\.0+)?$/.test(amount)) return 0n;
    return parseAmount(amount, this.decimals(token));
  }
  private fmt(token: TokenSymbol, units: bigint) {
    return formatAmount(units, this.decimals(token));
  }
  private fee(): Fee {
    return { label: "Network fee", amount: FEE, token: "USDC" };
  }
  /** Debits `units` of token plus the USDC fee; all-or-nothing. */
  private debit(w: WalletRef, token: TokenSymbol, units: bigint) {
    const fee = this.units("USDC", FEE);
    const needToken = units + (token === "USDC" ? fee : 0n);
    if (this.bal(w, token) < needToken || this.bal(w, "USDC") < (token === "USDC" ? needToken : fee)) {
      throw new ArcieError("INSUFFICIENT_BALANCE", {
        vars: { have: this.fmt(token, this.bal(w, token)), want: this.fmt(token, units), token },
      });
    }
    this.balances.set(this.key(w, token), this.bal(w, token) - units);
    this.balances.set(this.key(w, "USDC"), this.bal(w, "USDC") - fee);
  }
  private credit(w: WalletRef, token: TokenSymbol, units: bigint) {
    this.balances.set(this.key(w, token), this.bal(w, token) + units);
  }
  private convert(tokenIn: TokenSymbol, tokenOut: TokenSymbol, amountIn: string) {
    const rate = this.rates.get(`${tokenIn}>${tokenOut}`) ?? this.usd[tokenIn] / this.usd[tokenOut];
    const inUnits = this.units(tokenIn, amountIn);
    const scaled = (inUnits * BigInt(Math.round(rate * Number(RATE_SCALE)))) / RATE_SCALE;
    const shift = this.decimals(tokenOut) - this.decimals(tokenIn);
    return shift >= 0 ? scaled * 10n ** BigInt(shift) : scaled / 10n ** BigInt(-shift);
  }
  private vault(address: `0x${string}`) {
    const v = this.vaults.find((x) => x.address.toLowerCase() === address.toLowerCase());
    if (!v) throw new ArcieError("VAULT_UNAVAILABLE", { detail: { address } });
    return v;
  }
  private tx(w: WalletRef, status: TxResult["status"] = "DONE", amountOut?: string): TxResult {
    const txHash = `0x${randomBytes(32).toString("hex")}`;
    const res: TxResult = { txHash, explorerUrl: getChain(w.chain).explorerTx(txHash), status };
    if (amountOut !== undefined) res.amountOut = amountOut;
    this.txStatus.set(txHash, res);
    return res;
  }
}
