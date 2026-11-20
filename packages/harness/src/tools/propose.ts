import { tokenName } from "@arcie/core";
import { z } from "zod";
import type { HarnessApi } from "../harness.js";
import { tool } from "./registry.js";

const token = z.enum(["USDC", "EURC", "cirBTC"]);
const amount = z.string().describe('The requested amount as a plain decimal, like "5" or "5.5". Use "all" only when the user asks for the full balance. Ask if no amount was provided.');

const savingsSelector = z.literal("savings").default("savings");

export const depositArgs = z.object({
  vault: savingsSelector,
  amount: z.string().describe('Plain decimal amount, like "20".'),
  token: z.enum(["USDC", "EURC"]).optional(),
});
export const withdrawArgs = z.object({ vault: savingsSelector, amount });

// Direct REST clients may still manage a previously chosen contract by its original selector.
export const legacyEarnArgs = {
  earn_deposit: depositArgs.extend({ vault: z.string().min(1).default("savings") }),
  earn_withdraw: withdrawArgs.extend({ vault: z.string().min(1).default("savings") }),
};

export function proposeTools(h: Pick<HarnessApi, "propose">) {
  return [
    tool({
      name: "propose_send",
      kind: "propose",
      description:
        "Prepare a send as soon as the recipient and amount are known. No contact or balance lookup is needed before calling. It looks up the recipient and opens a choice or a confirmation. It does not move money.",
      args: z.object({
        to: z.string().min(1).describe("Contact name, contact id from a choice, or 0x address."),
        amount,
        token: token.default("USDC"),
      }),
      stepLabel: (a) => `Preparing to send ${a.amount === "all" ? "all your" : a.amount} ${tokenName(a.token)}`,
      run: (ctx, a) => h.propose(ctx, "send", a),
    }),
    tool({
      name: "propose_swap",
      kind: "propose",
      description: "Prepare swapping one token for another (USDC, EURC, cirBTC). Shows a confirm card with the quote.",
      args: z.object({
        tokenIn: token,
        tokenOut: token,
        amountIn: z.string().describe('Plain decimal amount of tokenIn, like "10".'),
        maxSlippageBps: z.number().int().min(0).max(10_000).optional(),
      }),
      stepLabel: (a) => `Getting a quote for ${a.amountIn} ${tokenName(a.tokenIn)} to ${tokenName(a.tokenOut)}`,
      run: (ctx, a) => h.propose(ctx, "swap", a),
    }),
    tool({
      name: "propose_earn_deposit",
      kind: "propose",
      description: "Prepare adding USD to Arcie Savings. Show a review before moving money.",
      args: depositArgs,
      stepLabel: (a) => `Preparing to add ${a.amount} ${tokenName(a.token ?? "USDC")} to savings`,
      run: (ctx, a) => h.propose(ctx, "earn_deposit", a),
    }),
    tool({
      name: "propose_earn_withdraw",
      kind: "propose",
      description: 'Prepare moving USD from savings back to the wallet. For "take my money out of savings" or "empty savings", use amount "all" directly. No balance lookup is needed first.',
      args: withdrawArgs,
      stepLabel: () => "Preparing a savings withdrawal",
      run: (ctx, a) => h.propose(ctx, "earn_withdraw", a),
    }),
  ];
}
