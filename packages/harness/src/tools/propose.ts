import { tokenName } from "@arcie/core";
import { z } from "zod";
import type { HarnessApi } from "../harness.js";
import { tool } from "./registry.js";

const token = z.enum(["USDC", "EURC", "cirBTC"]);
const amount = z.string().describe('A plain decimal like "5" or "5.5", or "all".');

export function proposeTools(h: Pick<HarnessApi, "propose">) {
  return [
    tool({
      name: "propose_send",
      kind: "propose",
      description:
        "Prepare sending money to a contact name, contact id or 0x address. Shows the user a confirm card; nothing moves until they confirm.",
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
      description: 'Prepare investing into an earning vault. Use vault "best" for the highest current APY.',
      args: z.object({
        vault: z.string().default("best").describe('"best", a vault address, or part of a vault name.'),
        amount: z.string().describe('Plain decimal amount, like "20".'),
        token: z.enum(["USDC", "EURC"]).optional(),
      }),
      stepLabel: (a) => `Preparing to invest ${a.amount} ${tokenName(a.token ?? "USDC")}`,
      run: (ctx, a) => h.propose(ctx, "earn_deposit", a),
    }),
    tool({
      name: "propose_earn_withdraw",
      kind: "propose",
      description: 'Prepare withdrawing from an earning vault back to the wallet. amount can be "all".',
      args: z.object({ vault: z.string().describe("Vault address or part of its name."), amount }),
      stepLabel: (a) => `Preparing to withdraw ${a.amount === "all" ? "everything" : a.amount}`,
      run: (ctx, a) => h.propose(ctx, "earn_withdraw", a),
    }),
  ];
}
