import type { Fee } from "@arcie/appkit";
import type { ConfirmIsland, TokenSymbol } from "@arcie/core";
import { tokenName } from "@arcie/core";
import { BUTTONS, feePhrase, feeRows, feeValue, promptWithFallback, rt, withNotes } from "./prompt.js";

export function buildSwapConfirm(i: {
  intentId: string;
  tokenIn: TokenSymbol;
  tokenOut: TokenSymbol;
  amountIn: string;
  estimatedOut: string;
  minOut: string;
  slippageBps: number;
  fees: Fee[];
  adjustments: string[];
  expiresAt: string;
}): ConfirmIsland {
  const pay = `${i.amountIn} ${tokenName(i.tokenIn)}`;
  const get = `${i.estimatedOut} ${tokenName(i.tokenOut)}`;
  const min = `${i.minOut} ${tokenName(i.tokenOut)}`;
  const protection = `${i.slippageBps / 100}%`;
  const risks = [`Price can move before it settles; you'll get at least ${min} or it won't go through.`];
  const feeParts = i.fees.flatMap((f, n) => {
    const v = feeValue(f);
    return [n === 0 ? " Fees: " : ", ", v ? { b: v } : "—", ` ${f.label.toLowerCase()}`];
  });
  const phrase = feePhrase(i.fees);

  return {
    kind: "confirm",
    intentId: i.intentId,
    title: `Swap ${pay} for about ${get}?`,
    chips: ["Swap", `${tokenName(i.tokenIn)} → ${tokenName(i.tokenOut)}`],
    rows: [
      { label: "You pay", value: pay },
      { label: "You get about", value: get, estimate: true },
      { label: "At least", value: min },
      { label: "Price protection", value: protection },
      ...feeRows(i.fees),
    ],
    adjustments: i.adjustments,
    risks,
    disclosure: withNotes(
      rt("You're swapping ", { b: pay }, " for about ", { b: get }, ". You'll get at least ", { b: min }, ` (${protection} price protection).`, ...feeParts, ...(i.fees.length ? ["."] : [])),
      i.adjustments,
      risks,
    ),
    buttons: { ...BUTTONS },
    expiresAt: i.expiresAt,
    spokenPrompt: promptWithFallback(
      `Swap ${pay} for about ${get}, at least ${i.minOut}${phrase ? `, ${phrase}` : ""}.`,
      `Swap ${pay} for about ${get}.`,
    ),
  };
}
