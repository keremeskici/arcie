import { formatAmount, parseAmount, spokenMessage, type ActionKind, type AgentLimits, type TokenSymbol, tokenName } from "@arcie/core";

export interface PolicyInput {
  action: ActionKind;
  token: TokenSymbol;
  tokenOut?: TokenSymbol;
  /** Requested amount (decimal string). With sendAll it is the full balance. */
  amount: string;
  usdValue: number;
  limits: AgentLimits;
  spentTodayUsd: number;
  balance: string;
  fee: { amount: string | null; token: TokenSymbol | null };
  slippageBps?: number;
  recipient?: { known: boolean };
  sendAll?: boolean;
  /** Balance of the fee token when it differs from `token`. Omitted = not checked. */
  gasBalance?: string;
  /** Withdrawals spend gas from the wallet, while `balance` represents the vault. */
  feeFromWallet?: boolean;
  decimals: number;
}

export type PolicyResult =
  | { ok: true; amount: string; adjustments: string[]; requireScreen: boolean }
  | { ok: false; code: "POLICY_DENIED" | "INSUFFICIENT_BALANCE"; reason: string };

const ACTION_WORDS: Record<ActionKind, string> = {
  send: "sending money",
  swap: "swapping",
  earn_deposit: "investing",
  earn_withdraw: "withdrawing from investments",
};

/** Parses a balance-like string that may be "0". */
function units(amount: string, decimals: number): bigint {
  return /^0(\.0+)?$/.test(amount) ? 0n : parseAmount(amount, decimals);
}

const usd = (n: number) => `$${Number.isInteger(n) ? n : n.toFixed(2)}`;

/** Pure policy gate (spec §8.4). Never throws for policy reasons; returns a disclosed reason instead. */
export function checkLimits(i: Pick<PolicyInput, "action" | "token" | "tokenOut" | "usdValue" | "limits" | "spentTodayUsd" | "slippageBps">): Extract<PolicyResult, { ok: false }> | null {
  const { limits } = i;
  const deny = (reason: string): Extract<PolicyResult, { ok: false }> => ({ ok: false, code: "POLICY_DENIED", reason });

  if (!limits.allowedActions.includes(i.action)) return deny(`You haven't allowed me to do ${ACTION_WORDS[i.action]}.`);
  if (!limits.allowedTokens.includes(i.token)) return deny(`You haven't allowed me to use ${tokenName(i.token)}.`);
  if (i.tokenOut && !limits.allowedTokens.includes(i.tokenOut)) return deny(`You haven't allowed me to use ${tokenName(i.tokenOut)}.`);
  if (i.slippageBps !== undefined && i.slippageBps > limits.maxSlippageBps) {
    return deny(`That price protection is looser than your ${limits.maxSlippageBps / 100}% limit.`);
  }
  if (i.action === "earn_withdraw") return null;
  if (i.usdValue > limits.maxPerTxUsd) {
    return deny(`That's about ${usd(i.usdValue)}, over your ${usd(limits.maxPerTxUsd)} per-transaction limit.`);
  }
  if (i.spentTodayUsd + i.usdValue > limits.dailyCapUsd) {
    const left = Math.max(0, limits.dailyCapUsd - i.spentTodayUsd);
    return deny(`That would go over your ${usd(limits.dailyCapUsd)} daily limit. You have ${usd(left)} left today.`);
  }
  return null;
}

export function checkPolicy(i: PolicyInput): PolicyResult {
  const denied = checkLimits(i);
  if (denied) return denied;
  const { limits } = i;

  const balance = units(i.balance, i.decimals);
  const feeInToken = !i.feeFromWallet && i.fee.amount !== null && i.fee.token === i.token ? units(i.fee.amount, i.decimals) : 0n;
  let amount = units(i.amount, i.decimals);
  const adjustments: string[] = [];

  if (i.sendAll && feeInToken > 0n) {
    amount = balance - feeInToken;
    if (amount <= 0n) return insufficient(i, i.balance);
    adjustments.push(
      `Sending ${formatAmount(amount, i.decimals)} ${tokenName(i.token)}: ${i.fee.amount} ${tokenName(i.token)} stays behind to pay the network fee.`,
    );
  }

  if (balance < amount + feeInToken) return insufficient(i, formatAmount(amount, i.decimals));

  if (i.fee.amount !== null && i.fee.token !== null && (i.feeFromWallet || i.fee.token !== i.token) && i.gasBalance !== undefined) {
    if (units(i.gasBalance, 6) < units(i.fee.amount, 6)) {
      return {
        ok: false,
        code: "INSUFFICIENT_BALANCE",
        reason: `You need a little ${tokenName(i.fee.token)} to pay the network fee, and you don't have enough.`,
      };
    }
  }

  const requireScreen = i.recipient?.known === false && limits.newRecipientRequiresScreen;
  return { ok: true, amount: formatAmount(amount, i.decimals), adjustments, requireScreen };
}

function insufficient(i: PolicyInput, want: string): PolicyResult {
  return {
    ok: false,
    code: "INSUFFICIENT_BALANCE",
    reason: spokenMessage("INSUFFICIENT_BALANCE", { have: i.balance, want, token: i.token }),
  };
}
