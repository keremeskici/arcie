import { isSavingsAddress } from "@arcie/appkit";
import type { ConfirmIsland } from "@arcie/core";
import type { Intent } from "../intents/repo.js";
import { BUTTONS, rt, spokenPrompt, withNotes } from "./prompt.js";

interface SavingsReview {
  intentId: string;
  direction: "deposit" | "withdraw";
  amount: string;
  annualRate: string | null;
  fees: ConfirmIsland["rows"];
  expected?: string | null;
  adjustments: string[];
  expiresAt: string;
}

export function buildSavingsConfirm(input: SavingsReview): ConfirmIsland {
  const deposit = input.direction === "deposit";
  const { amount, annualRate } = input;
  const risks = deposit
    ? ["The rate can change. You could lose money if the contract holding your savings fails."]
    : ["The amount you withdraw stops earning."];
  let serviceFees = 0;
  const fees = input.fees.map((fee) => {
    if (fee.label === "Network fee") return fee;
    serviceFees++;
    return { ...fee, label: serviceFees === 1 ? "Service fee" : `Service fee ${serviceFees}` };
  });
  const rows: ConfirmIsland["rows"] = [
    { label: "Amount", value: amount },
    { label: "From", value: deposit ? "Wallet" : "Savings" },
    { label: "To", value: deposit ? "Savings" : "Wallet" },
    { label: "Annual rate", value: annualRate, estimate: true },
  ];
  if (!deposit) rows.push({ label: "Back in your wallet", value: input.expected ?? null, estimate: true });
  return {
    kind: "confirm",
    action: deposit ? "earn_deposit" : "earn_withdraw",
    intentId: input.intentId,
    title: deposit ? `Add ${amount} to savings?` : `Withdraw ${amount} from savings?`,
    chips: [deposit ? "Deposit" : "Withdraw", "USD"],
    rows: [...rows, ...fees],
    risks,
    adjustments: input.adjustments,
    disclosure: withNotes(rt(deposit ? "You're adding " : "You're withdrawing ", { b: amount }, deposit ? " to savings." : " from savings."), input.adjustments, risks),
    buttons: { ...BUTTONS },
    expiresAt: input.expiresAt,
    spokenPrompt: spokenPrompt(deposit
      ? `Add ${amount} to savings${annualRate ? ` at a variable annual rate of ${annualRate}` : ""}.`
      : `Withdraw ${amount} from savings to your wallet.`),
  };
}

/** Earlier reviews stored the rendered terms. Use those exact values when reopening the pinned USD product. */
export function savedReview(intent: Intent): ConfirmIsland | null {
  const card = intent.preview?.island as ConfirmIsland | undefined;
  if (!card) return null;
  if (card.action || (intent.kind !== "earn_deposit" && intent.kind !== "earn_withdraw") ||
      intent.params.token !== "USDC" || typeof intent.params.vault !== "string" ||
      !isSavingsAddress(intent.chain, intent.params.vault)) return card;
  const deposit = intent.kind === "earn_deposit";
  const [amount, destination, rate, expected] = card.rows;
  if (amount?.label !== "Amount" || !amount.value || destination?.label !== "Vault" || rate?.label !== "Current APY" ||
      (!deposit && expected?.label !== "You get about")) return card;
  return buildSavingsConfirm({
    intentId: card.intentId, direction: deposit ? "deposit" : "withdraw", amount: amount.value,
    annualRate: rate.value, expected: expected?.value ?? null, fees: card.rows.slice(deposit ? 3 : 4),
    adjustments: card.adjustments, expiresAt: card.expiresAt,
  });
}
