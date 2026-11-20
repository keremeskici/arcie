import { getChain, isSavingsAddress, type Fee, type TxResult, type WalletRef } from "@arcie/appkit";
import { DEFAULT_LIMITS, ArcieError, formatAmount, parseAmount, type ActionKind, type ConfirmIsland, type TokenSymbol, tokenName } from "@arcie/core";
import type { HarnessCtx } from "./context.js";
import { buildSavingsConfirm } from "./disclosure/savings.js";
import { buildEarnConfirm } from "./disclosure/earn.js";
import { apyText, feeRows, feeValue } from "./disclosure/prompt.js";
import { buildSendConfirm } from "./disclosure/send.js";
import { buildSwapConfirm } from "./disclosure/swap.js";
import { checkFunds, checkPolicy } from "./policy/check.js";
import { balancesOf, ceilDecimals, gasFeeTotal, resolveRecipient, resolveVault, usdValueOf, walletFor, type Svc } from "./services.js";

export type Prepared =
  | { type: "choice"; send: { amount: string; token: TokenSymbol }; question: string; options: { id: string; label: string; detail: string }[] }
  | { type: "rejected"; code: "POLICY_DENIED" | "INSUFFICIENT_BALANCE"; reason: string; params: Record<string, unknown>; usdValue: number }
  | {
      type: "ready";
      params: Record<string, unknown>;
      preview: Record<string, unknown>;
      usdValue: number;
      requireScreen: boolean;
      /** Receipt "estimated" column. */
      estimated: Record<string, string | null>;
      buildIsland: (intentId: string, expiresAt: string) => ConfirmIsland;
    };

export type Executed = { tx: TxResult; actual: Record<string, string | null>; summary: string; balanceToken: TokenSymbol };

const decimalsOf = (w: WalletRef, t: TokenSymbol) => getChain(w.chain).tokens[t].decimals;

async function common(svc: Svc, ctx: HarnessCtx, w: WalletRef) {
  const [limits, balances] = await Promise.all([svc.policy.getLimits(ctx.userId), balancesOf(svc, w)]);
  return { limits, balances, spent: await svc.repo.spentTodayUsd(ctx.userId, ctx.now()), gas: getChain(w.chain).gasToken };
}

// ---------- send ----------
export interface SendArgs { to: string; amount: string; token: TokenSymbol }

async function sendFunds(svc: Pick<Svc, "kit">, w: WalletRef, balances: Record<TokenSymbol, string>, to: `0x${string}`, token: TokenSymbol, amount: string) {
  const decimals = decimalsOf(w, token);
  const balance = balances[token] ?? "0";
  const sendAll = amount === "all";
  if (sendAll && /^0(\.0+)?$/.test(balance)) throw new ArcieError("INSUFFICIENT_BALANCE", { spoken: `You don't have any ${tokenName(token)} to send.` });
  const requested = sendAll ? balance : amount;
  // A one-base-unit transfer can be simulated without first spending the full balance on gas.
  const { fee } = await svc.kit.estimateSend(w, { to, amount: sendAll ? formatAmount(1n, decimals) : requested, token });
  if (sendAll && (fee.amount === null || fee.token === null)) throw new ArcieError("RPC_UNAVAILABLE", { spoken: "The network fee is unavailable. Try Send all again." });
  const gas = getChain(w.chain).gasToken;
  const rounded = fee.amount === null ? null : ceilDecimals(fee.amount, decimalsOf(w, gas));
  const funds = { token, amount: requested, balance, fee: { amount: rounded, token: fee.token }, sendAll, gasBalance: balances[gas] ?? "0", decimals };
  return { fee, funds };
}

/** Read-only maximum. Spending limits are enforced when the actual request is reviewed. */
export async function quoteSendMax(svc: Pick<Svc, "kit" | "db">, ctx: HarnessCtx, to: string | undefined, token: TokenSymbol) {
  const recipient = to ? await resolveRecipient(svc, ctx.userId, to) : undefined;
  if (recipient?.kind === "choice") throw new ArcieError("INVALID_RECIPIENT", { spoken: "Choose the exact contact to calculate the amount." });
  const w = await walletFor(svc, ctx);
  const balances = await balancesOf(svc, w);
  if (!recipient) return { amount: balances[token] ?? "0", feeChecked: false };
  const { funds } = await sendFunds(svc, w, balances, recipient.recipient.address, token, "all");
  const result = checkFunds(funds);
  if (!result.ok) throw new ArcieError(result.code, { spoken: result.reason });
  return { amount: result.amount, feeChecked: true };
}

async function prepareSend(svc: Svc, ctx: HarnessCtx, w: WalletRef, a: SendArgs): Promise<Prepared> {
  const rec = await resolveRecipient(svc, ctx.userId, a.to);
  if (rec.kind === "choice") return { type: "choice", send: { amount: a.amount, token: a.token }, question: "Which contact did you mean?", options: rec.options };
  const r = rec.recipient;
  if (a.amount !== "all") parseAmount(a.amount, decimalsOf(w, a.token));

  const { limits, balances, spent } = await common(svc, ctx, w);
  const { fee, funds } = await sendFunds(svc, w, balances, r.address, a.token, a.amount);
  const usdValue = await usdValueOf(svc, w, a.token, funds.amount);
  const res = checkPolicy({ ...funds, action: "send", usdValue, limits, spentTodayUsd: spent, recipient: { known: r.known } });
  const params = { to: r.address, amount: a.amount, token: a.token };
  if (!res.ok) return { type: "rejected", code: res.code, reason: res.reason, params, usdValue };

  const money = `${res.amount} ${tokenName(a.token)}`;
  return {
    type: "ready",
    params: { to: r.address, amount: res.amount, token: a.token, recipientLabel: r.label, recipientIsNew: !r.known },
    preview: {},
    usdValue,
    requireScreen: res.requireScreen,
    estimated: { Sent: money, "Network fee": feeValue(fee) },
    buildIsland: (intentId, expiresAt) =>
      buildSendConfirm({ intentId, amount: res.amount, token: a.token, recipientLabel: r.label, recipientAddress: r.address, recipientIsNew: !r.known, fee, adjustments: res.adjustments, expiresAt }),
  };
}

async function executeSend(svc: Svc, w: WalletRef, p: Record<string, unknown>): Promise<Executed> {
  const { to, amount, token, recipientLabel } = p as { to: `0x${string}`; amount: string; token: TokenSymbol; recipientLabel: string };
  const tx = await svc.kit.send(w, { to, amount, token });
  return { tx, actual: { Sent: `${amount} ${tokenName(token)}` }, summary: `Done. Sent ${amount} ${tokenName(token)} to ${recipientLabel}.`, balanceToken: token };
}

// ---------- swap ----------
export const defaultSwapSlippage = (accountCap: number) => Math.min(DEFAULT_LIMITS.maxSlippageBps, accountCap);

export interface SwapArgs { tokenIn: TokenSymbol; tokenOut: TokenSymbol; amountIn: string; maxSlippageBps?: number | undefined }

export async function quoteSwap(svc: Svc, w: WalletRef, a: { tokenIn: TokenSymbol; tokenOut: TokenSymbol; amountIn: string }, slippageBps: number) {
  const allowed = getChain(w.chain).capabilities.swap;
  if (!allowed.includes(a.tokenIn) || !allowed.includes(a.tokenOut) || a.tokenIn === a.tokenOut) {
    throw new ArcieError("POLICY_DENIED", { spoken: `I can swap between ${allowed.join(", ")} here.` });
  }
  parseAmount(a.amountIn, decimalsOf(w, a.tokenIn));
  return svc.kit.estimateSwap(w, { ...a, slippageBps });
}

export async function prepareSwap(svc: Svc, ctx: HarnessCtx, w: WalletRef, a: SwapArgs): Promise<Exclude<Prepared, { type: "choice" }>> {
  const { limits, balances, spent, gas } = await common(svc, ctx, w);
  const slippageBps = a.maxSlippageBps ?? defaultSwapSlippage(limits.maxSlippageBps);
  const est = await quoteSwap(svc, w, a, slippageBps);
  const usdValue = await usdValueOf(svc, w, a.tokenIn, a.amountIn);
  const res = checkPolicy({
    action: "swap", token: a.tokenIn, tokenOut: a.tokenOut, amount: a.amountIn, usdValue, limits, spentTodayUsd: spent,
    balance: balances[a.tokenIn] ?? "0", fee: gasFeeTotal(est.fees, w.chain), slippageBps,
    gasBalance: balances[gas] ?? "0", decimals: decimalsOf(w, a.tokenIn),
  });
  const params = { tokenIn: a.tokenIn, tokenOut: a.tokenOut, amountIn: a.amountIn, slippageBps, minOut: est.minOut };
  if (!res.ok) return { type: "rejected", code: res.code, reason: res.reason, params, usdValue };

  return {
    type: "ready",
    params,
    preview: { estimatedOut: est.estimatedOut, minOut: est.minOut, fees: est.fees },
    usdValue,
    requireScreen: false,
    estimated: { "You got": `${est.estimatedOut} ${tokenName(a.tokenOut)}` },
    buildIsland: (intentId, expiresAt) => swapIsland(intentId, params, est, res.adjustments, expiresAt),
  };
}

export function swapIsland(
  intentId: string,
  p: { tokenIn: TokenSymbol; tokenOut: TokenSymbol; amountIn: string; slippageBps: number },
  est: { estimatedOut: string; minOut: string; fees: Fee[] },
  adjustments: string[],
  expiresAt: string,
): ConfirmIsland {
  return buildSwapConfirm({ intentId, ...p, estimatedOut: est.estimatedOut, minOut: est.minOut, fees: est.fees, adjustments, expiresAt });
}

async function executeSwap(svc: Svc, w: WalletRef, p: Record<string, unknown>): Promise<Executed> {
  const params = p as { tokenIn: TokenSymbol; tokenOut: TokenSymbol; amountIn: string; slippageBps: number };
  const tx = await svc.kit.swap(w, params);
  const out = tx.amountOut ? `${tx.amountOut} ${tokenName(params.tokenOut)}` : null;
  return {
    tx,
    actual: { "You got": out },
    summary: out ? `Done. You got ${out}.` : `Your swap is processing.`,
    balanceToken: params.tokenOut,
  };
}

// ---------- earn ----------
export interface EarnDepositArgs { vault: string; amount: string; token?: TokenSymbol | undefined }
export interface EarnWithdrawArgs { vault: string; amount: string }

async function prepareDeposit(svc: Svc, ctx: HarnessCtx, w: WalletRef, a: EarnDepositArgs): Promise<Prepared> {
  const vault = await resolveVault(svc, w.chain, a.vault, a.token ?? "USDC");
  const decimals = decimalsOf(w, vault.token);
  parseAmount(a.amount, decimals);
  const { limits, balances, spent, gas } = await common(svc, ctx, w);
  const q = await svc.kit.getDepositQuote(w, { vault: vault.address, amount: a.amount });
  const usdValue = await usdValueOf(svc, w, vault.token, a.amount);
  const res = checkPolicy({
    action: "earn_deposit", token: vault.token, amount: a.amount, usdValue, limits, spentTodayUsd: spent,
    balance: balances[vault.token] ?? "0", fee: gasFeeTotal(q.fees, w.chain), gasBalance: balances[gas] ?? "0", decimals,
  });
  const savings = vault.token === "USDC" && isSavingsAddress(w.chain, vault.address);
  const params = { vault: vault.address, vaultName: savings ? "Savings" : q.vaultName, amount: a.amount, token: vault.token };
  if (!res.ok) return { type: "rejected", code: res.code, reason: res.reason, params, usdValue };
  return {
    type: "ready",
    params,
    preview: { apy: q.apy, fees: q.fees },
    usdValue,
    requireScreen: false,
    estimated: { [savings ? "Added to savings" : "Invested"]: `${a.amount} ${tokenName(vault.token)}` },
    buildIsland: (intentId, expiresAt) =>
      savings ? buildSavingsConfirm({ intentId, direction: "deposit", amount: `${a.amount} USD`, annualRate: apyText(q.apy), fees: feeRows(q.fees), adjustments: res.adjustments, expiresAt }) :
      buildEarnConfirm({ intentId, direction: "deposit", vaultName: q.vaultName, amount: a.amount, token: vault.token, apy: q.apy, fees: q.fees, adjustments: res.adjustments, expiresAt }),
  };
}

async function prepareWithdraw(svc: Svc, ctx: HarnessCtx, w: WalletRef, a: EarnWithdrawArgs): Promise<Prepared> {
  const vault = await resolveVault(svc, w.chain, a.vault);
  const savings = vault.token === "USDC" && isSavingsAddress(w.chain, vault.address);
  const position = await svc.kit.getPosition(w, vault.address);
  if (!position) throw new ArcieError("NOT_FOUND", { spoken: savings ? "You have no money in savings to withdraw." : "You don't have money in that investment." });
  const amount = a.amount === "all" ? position.currentBalance : a.amount;
  const decimals = decimalsOf(w, vault.token);
  parseAmount(amount, decimals);
  const { limits, spent, balances, gas } = await common(svc, ctx, w);
  const q = await svc.kit.getWithdrawalQuote(w, { vault: vault.address, amount });
  const usdValue = await usdValueOf(svc, w, vault.token, amount);
  // Money returns to the user's own wallet: limits don't apply (usdValue 0), but the position must cover it.
  const res = checkPolicy({
    action: "earn_withdraw", token: vault.token, amount, usdValue: 0, limits, spentTodayUsd: spent,
    balance: position.currentBalance, fee: gasFeeTotal(q.fees, w.chain), decimals,
    gasBalance: balances[gas] ?? "0", feeFromWallet: true,
  });
  const params = { vault: vault.address, vaultName: savings ? "Savings" : vault.name, amount, token: vault.token };
  if (!res.ok) return { type: "rejected", code: res.code, reason: res.reason, params, usdValue };
  return {
    type: "ready",
    params,
    preview: { expectedAmount: q.expectedAmount, fees: q.fees },
    usdValue,
    requireScreen: false,
    estimated: { "Back in your wallet": `${q.expectedAmount} ${tokenName(vault.token)}` },
    buildIsland: (intentId, expiresAt) =>
      savings ? buildSavingsConfirm({ intentId, direction: "withdraw", amount: `${amount} USD`, annualRate: apyText(vault.apy), fees: feeRows(q.fees), expected: `${q.expectedAmount} USD`, adjustments: res.adjustments, expiresAt }) :
      buildEarnConfirm({ intentId, direction: "withdraw", vaultName: vault.name, amount, token: vault.token, apy: position.apy, fees: q.fees, expectedAmount: q.expectedAmount, adjustments: res.adjustments, expiresAt }),
  };
}

async function executeDeposit(svc: Svc, w: WalletRef, p: Record<string, unknown>): Promise<Executed> {
  const { vault, vaultName, amount, token } = p as { vault: `0x${string}`; vaultName: string; amount: string; token: TokenSymbol };
  const tx = await svc.kit.deposit(w, { vault, amount });
  if (token === "USDC" && isSavingsAddress(w.chain, vault)) {
    // Older reviews estimated "Invested". Keep the receipt columns aligned with that approval.
    const label = vaultName === "Savings" ? "Added to savings" : "Invested";
    return { tx, actual: { [label]: `${amount} USD` }, summary: `${amount} USD was added to your savings.`, balanceToken: token };
  }
  return { tx, actual: { Invested: `${amount} ${tokenName(token)}` }, summary: `Done. ${amount} ${tokenName(token)} is now earning in ${vaultName}.`, balanceToken: token };
}

async function executeWithdraw(svc: Svc, w: WalletRef, p: Record<string, unknown>): Promise<Executed> {
  const { vault, amount, token } = p as { vault: `0x${string}`; amount: string; token: TokenSymbol };
  const tx = await svc.kit.withdraw(w, { vault, amount });
  return { tx, actual: { "Back in your wallet": `${amount} ${tokenName(token)}` }, summary: `Done. ${amount} ${tokenName(token)} is back in your wallet.`, balanceToken: token };
}

export const ACTIONS: Record<ActionKind, {
  prepare: (svc: Svc, ctx: HarnessCtx, w: WalletRef, args: never) => Promise<Prepared>;
  execute: (svc: Svc, w: WalletRef, params: Record<string, unknown>) => Promise<Executed>;
}> = {
  send: { prepare: prepareSend, execute: executeSend },
  swap: { prepare: prepareSwap, execute: executeSwap },
  earn_deposit: { prepare: prepareDeposit, execute: executeDeposit },
  earn_withdraw: { prepare: prepareWithdraw, execute: executeWithdraw },
};
