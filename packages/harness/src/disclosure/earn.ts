import type { Fee } from "@arcie/appkit";
import type { ConfirmIsland, TokenSymbol } from "@arcie/core";
import { tokenName } from "@arcie/core";
import { apyText, BUTTONS, feeRows, promptWithFallback, rt, withNotes } from "./prompt.js";

const DEPOSIT_RISKS = ["APY is variable and not guaranteed.", "Your money sits in a vault contract until you withdraw."];
const WITHDRAW_RISKS = ["You stop earning on the amount you withdraw."];

export function buildEarnConfirm(i: {
  intentId: string;
  direction: "deposit" | "withdraw";
  vaultName: string;
  amount: string;
  token: TokenSymbol;
  apy: number | null;
  fees: Fee[];
  expectedAmount?: string;
  adjustments: string[];
  expiresAt: string;
}): ConfirmIsland {
  const money = `${i.amount} ${tokenName(i.token)}`;
  const apy = apyText(i.apy);
  const deposit = i.direction === "deposit";
  const risks = deposit ? DEPOSIT_RISKS : WITHDRAW_RISKS;
  const expected = i.expectedAmount ? `${i.expectedAmount} ${tokenName(i.token)}` : null;

  const disclosure = deposit
    ? rt("You're putting ", { b: money }, ` into ${i.vaultName}`, ...(apy ? [", currently earning ", { b: `${apy} APY` }] : []), ".")
    : rt("You're withdrawing ", { b: money }, ` from ${i.vaultName}`, ...(expected ? [". You'll get about ", { b: expected }] : []), ".");

  return {
    kind: "confirm",
    intentId: i.intentId,
    title: deposit ? `Put ${money} into ${i.vaultName}?` : `Withdraw ${money} from ${i.vaultName}?`,
    chips: [deposit ? "Invest" : "Withdraw", tokenName(i.token), ...(apy ? [`${apy} APY`] : [])],
    rows: [
      { label: "Amount", value: money },
      { label: "Vault", value: i.vaultName },
      { label: "Current APY", value: apy, estimate: true },
      ...(deposit ? [] : [{ label: "You get about", value: expected, estimate: true }]),
      ...feeRows(i.fees),
    ],
    adjustments: i.adjustments,
    risks: [...risks],
    disclosure: withNotes(disclosure, i.adjustments, [...risks]),
    buttons: { ...BUTTONS },
    expiresAt: i.expiresAt,
    spokenPrompt: deposit
      ? promptWithFallback(`Put ${money} into ${i.vaultName}${apy ? ` at about ${apy} APY` : ""}.`, `Invest ${money}${apy ? ` at about ${apy} APY` : ""}.`)
      : promptWithFallback(`Withdraw ${money} from ${i.vaultName}.`, `Withdraw ${money} from your vault.`),
  };
}
