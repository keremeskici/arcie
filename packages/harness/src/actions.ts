import { getChain, type Fee, type TxResult, type WalletRef } from "@arcie/appkit";
import { ArcieError, parseAmount, type ActionKind, type ConfirmIsland, type TokenSymbol, tokenName } from "@arcie/core";
import type { HarnessCtx } from "./context.js";
import { buildEarnConfirm } from "./disclosure/earn.js";
import { feeValue } from "./disclosure/prompt.js";
import { buildSendConfirm } from "./disclosure/send.js";
import { buildSwapConfirm } from "./disclosure/swap.js";
import { checkPolicy } from "./policy/check.js";
import { balancesOf, ceilDecimals, gasFeeTotal, resolveRecipient, resolveVault, usdValueOf, type Svc } from "./services.js";

export type Prepared =
  | { type: "choice"; question: string; options: { id: string; label: string; detail: string }[] }
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

async function prepareSend(svc: Svc, ctx: HarnessCtx, w: WalletRef, a: SendArgs): Promise<Prepared> {
  const rec = await resolveRecipient(svc, ctx.userId, a.to);
  if (rec.kind === "choice") return { type: "choice", question: "Which contact did you mean?", options: rec.options };
  const r = rec.recipient;
  const decimals = decimalsOf(w, a.token);
  const sendAll = a.amount === "all";
  if (!sendAll) parseAmount(a.amount, decimals);

  const { limits, balances, spent, gas } = await common(svc, ctx, w);
  const balance = balances[a.token] ?? "0";
  if (sendAll && /^0(\.0+)?$/.test(balance)) throw new ArcieError("INSUFFICIENT_BALANCE", { spoken: `You don't have any ${tokenName(a.token)} to send.` });
  const requested = sendAll ? balance : a.amount;
  // Fee barely depends on the amount; quoting the full balance can fail gas simulation, so quote a tiny send.
  const { fee } = await svc.kit.estimateSend(w, { to: r.address, amount: sendAll ? "0.000001" : requested, token: a.token });
  const feeRounded = fee.amount === null ? null : ceilDecimals(fee.amount, decimalsOf(w, gas));
  const usdValue = await usdValueOf(svc, w, a.token, requested);

  const res = checkPolicy({
    action: "send", token: a.token, amount: requested, usdValue, limits, spentTodayUsd: spent, balance,
    fee: { amount: feeRounded, token: fee.token }, recipient: { known: r.known }, sendAll,
    gasBalance: balances[gas] ?? "0", decimals,
  });
  const params = { to: r.address, amount: sendAll ? "all" : a.amount, token: a.token };
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
      buildSendConfirm({ intentId, amount: res.amount, token: a.token, recipientLabel: r.label, recipientIsNew: !r.known, fee, adjustments: res.adjustments, expiresAt }),
  };
}

async function executeSend(svc: Svc, w: WalletRef, p: Record<string, unknown>): Promise<Executed> {
  const { to, amount, token, recipientLabel } = p as { to: `0x${string}`; amount: string; token: TokenSymbol; recipientLabel: string };
  const tx = await svc.kit.send(w, { to, amount, token });
  return { tx, actual: { Sent: `${amount} ${tokenName(token)}` }, summary: `Done. Sent ${amount} ${tokenName(token)} to ${recipientLabel}.`, balanceToken: token };
}

// ---------- swap ----------
export interface SwapArgs { tokenIn: TokenSymbol; tokenOut: TokenSymbol; amountIn: string; maxSlippageBps?: number | undefined }

export async function quoteSwap(svc: Svc, w: WalletRef, a: { tokenIn: TokenSymbol; tokenOut: TokenSymbol; amountIn: string }, slippageBps: number) {
  const allowed = getChain(w.chain).capabilities.swap;
  if (!allowed.includes(a.tokenIn) || !allowed.includes(a.tokenOut) || a.tokenIn === a.tokenOut) {
    throw new ArcieError("POLICY_DENIED", { spoken: `I can swap between ${allowed.join(", ")} here.` });
  }
  parseAmount(a.amountIn, decimalsOf(w, a.tokenIn));
  return svc.kit.estimateSwap(w, { ...a, slippageBps });
}

async function prepareSwap(svc: Svc, ctx: HarnessCtx, w: WalletRef, a: SwapArgs): Promise<Prepared> {
  const { limits, balances, spent, gas } = await common(svc, ctx, w);
  const slippageBps = a.maxSlippageBps ?? limits.maxSlippageBps;
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
  const params = { vault: vault.address, vaultName: q.vaultName, amount: a.amount, token: vault.token };
  if (!res.ok) return { type: "rejected", code: res.code, reason: res.reason, params, usdValue };
  return {
    type: "ready",
    params,
    preview: { apy: q.apy, fees: q.fees },
    usdValue,
    requireScreen: false,
    estimated: { Invested: `${a.amount} ${tokenName(vault.token)}` },
    buildIsland: (intentId, expiresAt) =>
      buildEarnConfirm({ intentId, direction: "deposit", vaultName: q.vaultName, amount: a.amount, token: vault.token, apy: q.apy, fees: q.fees, adjustments: res.adjustments, expiresAt }),
  };
}

async function prepareWithdraw(svc: Svc, ctx: HarnessCtx, w: WalletRef, a: EarnWithdrawArgs): Promise<Prepared> {
  const vault = await resolveVault(svc, w.chain, a.vault);
  const position = await svc.kit.getPosition(w, vault.address);
  if (!position) throw new ArcieError("NOT_FOUND", { spoken: "You don't have money in that vault." });
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
  const params = { vault: vault.address, vaultName: vault.name, amount, token: vault.token };
  if (!res.ok) return { type: "rejected", code: res.code, reason: res.reason, params, usdValue };
  return {
    type: "ready",
    params,
    preview: { expectedAmount: q.expectedAmount, fees: q.fees },
    usdValue,
    requireScreen: false,
    estimated: { "Back in your wallet": `${q.expectedAmount} ${tokenName(vault.token)}` },
    buildIsland: (intentId, expiresAt) =>
      buildEarnConfirm({ intentId, direction: "withdraw", vaultName: vault.name, amount, token: vault.token, apy: position.apy, fees: q.fees, expectedAmount: q.expectedAmount, adjustments: res.adjustments, expiresAt }),
  };
}

async function executeDeposit(svc: Svc, w: WalletRef, p: Record<string, unknown>): Promise<Executed> {
  const { vault, vaultName, amount, token } = p as { vault: `0x${string}`; vaultName: string; amount: string; token: TokenSymbol };
  const tx = await svc.kit.deposit(w, { vault, amount });
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
