import type { Fee } from "@arcie/appkit";
import type { ConfirmIsland, TokenSymbol } from "@arcie/core";
import { tokenName } from "@arcie/core";
import { BUTTONS, feePhrase, feeValue, promptWithFallback, rt, withNotes } from "./prompt.js";

export function buildSendConfirm(i: {
  intentId: string;
  amount: string;
  token: TokenSymbol;
  recipientLabel: string;
  recipientAddress?: string;
  recipientIsNew: boolean;
  fee: Fee;
  adjustments: string[];
  expiresAt: string;
}): ConfirmIsland {
  const money = `${i.amount} ${tokenName(i.token)}`;
  const fee = feeValue(i.fee);
  const risks = ["Onchain transfers can't be reversed.", ...(i.recipientIsNew ? ["This is a new recipient."] : [])];
  const phrase = feePhrase([i.fee]);
  const spokenRecipient = i.recipientIsNew ? "a new recipient" : i.recipientLabel;

  return {
    kind: "confirm",
    action: "send",
    send: { amount: i.amount, token: i.token, recipient: i.recipientLabel, ...(i.recipientAddress ? { address: i.recipientAddress } : {}) },
    intentId: i.intentId,
    title: `Send ${money} to ${i.recipientLabel}?`,
    chips: ["Send", tokenName(i.token), "Arc"],
    rows: [
      { label: "Amount", value: money },
      { label: "To", value: i.recipientIsNew ? `${i.recipientLabel} (new)` : i.recipientLabel },
      { label: i.fee.label, value: fee, estimate: true },
    ],
    adjustments: i.adjustments,
    risks,
    disclosure: withNotes(
      rt("You're sending ", { b: money }, ` to ${i.recipientLabel}.`, ...(fee ? [" The network fee is about ", { b: fee }, "."] : [" The network fee isn't known yet."])),
      i.adjustments,
      risks,
    ),
    buttons: { ...BUTTONS },
    expiresAt: i.expiresAt,
    spokenPrompt: promptWithFallback(
      `Send ${money} to ${spokenRecipient}${phrase ? `, ${phrase}` : ""}.`,
      `Send ${money}?`,
    ),
  };
}
