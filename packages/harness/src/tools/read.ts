import { getAddress } from "viem";
import { findSavings, getChain, HOME_CHAIN, readSavings } from "@arcie/appkit";
import { ArcieError, tokenName, type IslandPayload, type TokenSymbol } from "@arcie/core";
import { contacts } from "@arcie/db";
import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { defaultSwapSlippage, quoteSwap, type SwapArgs } from "../actions.js";
import { readWalletBalances } from "../balances.js";
import type { HarnessCtx } from "../context.js";
import { apyText } from "../disclosure/prompt.js";
import { countWord, joinNames, resolveRecipient, walletFor, type Svc } from "../services.js";
import { readActivity, readIntent } from "./activity.js";
import { tool } from "./registry.js";

const token = z.enum(["USDC", "EURC", "cirBTC"]);
const actionKind = z.enum(["send", "swap", "earn_deposit", "earn_withdraw"]);
const currency = { USDC: "dollars", EURC: "euros", cirBTC: "bitcoin" } as const;
const isZero = (s: string) => /^0(\.0+)?$/.test(s);
const dollars = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
function spokenDollars(amount: number) {
  return amount > 0 && amount < 0.01 ? "less than a cent" : dollars.format(amount);
}

function currencyUnit(symbol: TokenSymbol, amount: number) {
  return amount === 1 && symbol !== "cirBTC" ? currency[symbol].slice(0, -1) : currency[symbol];
}

function openScreen(svc: Svc, ctx: HarnessCtx, screen: "contacts" | "activity") {
  const island = { kind: "open_screen", screen, requestId: randomUUID() } satisfies IslandPayload;
  svc.bus.publish(ctx.sessionId, island);
  return { summary: `I've opened your ${screen}.`, data: { screen }, island };
}

export async function readSwapQuote(svc: Svc, ctx: HarnessCtx, { maxSlippageBps, ...a }: SwapArgs) {
  const w = await walletFor(svc, ctx);
  const limits = await svc.policy.getLimits(ctx.userId);
  const slippageBps = maxSlippageBps ?? defaultSwapSlippage(limits.maxSlippageBps);
  if (slippageBps > limits.maxSlippageBps) {
    throw new ArcieError("POLICY_DENIED", { spoken: `That price protection is looser than your ${limits.maxSlippageBps / 100}% limit.` });
  }
  const q = await quoteSwap(svc, w, a, slippageBps);
  return { summary: `${a.amountIn} ${tokenName(a.tokenIn)} gets you about ${q.estimatedOut} ${tokenName(a.tokenOut)} right now.`, data: { ...q, slippageBps } };
}

export function readTools(svc: Svc) {
  return [
    tool({
      name: "get_balances",
      kind: "read",
      description: "Wallet balance. In voice, use no arguments for the total dollar value, token for one requested currency, or breakdown only for an explicit itemized breakdown.",
      args: z.object({ token: token.optional(), breakdown: z.boolean().optional() }),
      stepLabel: () => "Checking your balance",
      run: async (ctx, a) => {
        const w = await walletFor(svc, ctx);
        if (ctx.channel === "voice" && !a.token && !a.breakdown) {
          const { tokens, totalUsd, knownSubtotalUsd } = await readWalletBalances(svc.kit, w, svc.tokenUsdPrice);
          if (totalUsd !== null) {
            return { summary: `Your wallet balance is ${dollars.format(totalUsd)}.`, data: { totalUsd } };
          }
          if (tokens.some((b) => !isZero(b.amount) && b.usd !== null)) {
            return { summary: `The part I can price is worth ${dollars.format(knownSubtotalUsd)}.`, data: { totalUsd, knownSubtotalUsd } };
          }
          return { summary: "I can't get your wallet's dollar value right now.", data: { totalUsd } };
        }
        const balances = await svc.kit.getBalances(w);
        if (a.token) {
          const balance = balances.find((b) => b.token === a.token) ?? { token: a.token, amount: "0" };
          const unit = currencyUnit(balance.token, Number(balance.amount));
          return { summary: `You have ${balance.amount} ${unit}.`, data: { balance } };
        }
        const held = balances.filter((b) => !isZero(b.amount)).map((b) => `${b.amount} ${tokenName(b.token)}`);
        return { summary: held.length ? `You have ${joinNames(held)}.` : "Your wallet is empty.", data: { balances } };
      },
    }),
    tool({
      name: "get_receive_info",
      kind: "read",
      description: "Show the user's own address so someone can pay them. The address goes on screen; never read it aloud.",
      args: z.object({}),
      stepLabel: () => "Getting your receive details",
      run: async (ctx) => {
        const w = await walletFor(svc, ctx);
        const island = { kind: "receive" as const, address: getAddress(w.address), chain: w.chain, tokens: getChain(w.chain).capabilities.send };
        if (!ctx.receiveResponseOnly) svc.bus.publish(ctx.sessionId, island);
        return { summary: "I've put your receive details on screen.", data: { chain: w.chain, tokens: island.tokens }, island };
      },
    }),
    tool({
      name: "find_contact",
      kind: "read",
      description: "Look up a saved contact by name. Set show only when the user explicitly asks to see the contact on screen.",
      args: z.object({ name: z.string().trim().min(1), show: z.boolean().optional() }),
      stepLabel: (a) => `Looking up ${a.name}`,
      run: async (ctx, a) => {
        const r = resolveRecipient(svc, ctx.userId, a.name);
        if (r.kind === "ok" && !r.recipient.known) return { summary: "That address isn't in your contacts.", data: { matches: [] } };
        if (ctx.channel === "voice" && a.show) return openScreen(svc, ctx, "contacts");
        if (r.kind === "choice") return { summary: `I found ${joinNames(r.options.map((o) => o.label))}.`, data: { matches: r.options } };
        const { label, address } = r.recipient;
        return { summary: `${label} is in your contacts.`, data: { matches: [ctx.channel === "voice" ? { label } : { label, address }] } };
      },
    }),
    tool({
      name: "list_contacts",
      kind: "read",
      description: "Summarize saved contacts. Set show when explicitly asked to open contacts on screen. Set names when explicitly asked to list the names aloud.",
      args: z.object({ show: z.boolean().optional(), names: z.boolean().optional() }),
      stepLabel: () => "Opening your contacts",
      run: async (ctx, a) => {
        if (ctx.channel === "voice" && a.show) return openScreen(svc, ctx, "contacts");
        const rows = svc.db.select().from(contacts).where(eq(contacts.userId, ctx.userId)).all();
        if (ctx.channel === "voice" && rows.length > 3 && !a.names) {
          return { summary: `You have ${countWord(rows.length)} saved contacts.`, data: { count: rows.length } };
        }
        return {
          summary: rows.length ? `Your contacts are ${joinNames(rows.map((r) => r.name))}.` : "You don't have any contacts yet.",
          data: { contacts: rows.map((r) => ({ id: r.id, name: r.name })) },
        };
      },
    }),
    tool({
      name: "get_swap_quote",
      kind: "read",
      description: "Price check only: how much tokenOut the user would get. Creates nothing.",
      args: z.object({ tokenIn: token, tokenOut: token, amountIn: z.string(), maxSlippageBps: z.number().int().min(0).max(10_000).optional() }),
      stepLabel: (a) => `Checking the ${tokenName(a.tokenIn)} to ${tokenName(a.tokenOut)} price`,
      run: async (ctx, a) => {
        const quote = await readSwapQuote(svc, ctx, a);
        if (ctx.channel !== "voice") return quote;
        const amount = Number(quote.data.estimatedOut);
        const digits = a.tokenOut === "cirBTC" ? 8 : 2;
        const minimum = 10 ** -digits;
        const unit = currencyUnit(a.tokenOut, Number(amount.toFixed(digits)));
        const estimate = amount > 0 && amount < minimum ? `less than ${minimum.toFixed(digits)}`
          : `about ${amount.toLocaleString("en-US", { maximumFractionDigits: digits })}`;
        return { ...quote, summary: `You'd get ${estimate} ${unit}.` };
      },
    }),
    tool({
      name: "list_earn_vaults",
      kind: "read",
      description: "Check availability and the current variable annual rate for Arcie Savings in USD.",
      args: z.object({ token: z.enum(["USDC", "EURC"]).optional() }),
      stepLabel: () => "Checking the savings rate",
      run: async (_ctx, a) => {
        if (a.token === "EURC") return { summary: "Arcie Savings accepts USD only.", data: { available: false } };
        const product = await findSavings(svc.kit, HOME_CHAIN);
        if (!product) return { summary: "Savings is unavailable right now.", data: { available: false, annualRate: null } };
        const annualRate = Number.isFinite(product.apy) ? product.apy : null;
        const rate = apyText(annualRate);
        const summary = rate ? `The current annual savings rate is ${rate}. It can change.`
          : "Savings is available. Its annual rate is currently unavailable.";
        return { summary, data: { available: true, annualRate } };
      },
    }),
    tool({
      name: "get_earn_positions",
      kind: "read",
      description: "Check Arcie Savings. Use view balance or earnings for one figure, or omit view for an overview of both.",
      args: z.object({ view: z.enum(["balance", "earnings"]).optional() }),
      stepLabel: () => "Checking your savings",
      run: async (ctx, a) => {
        const savings = await readSavings(svc.kit, await walletFor(svc, ctx));
        if (!savings.available) return { summary: "Savings is unavailable right now.", data: savings };
        const balanceSummary = `You have ${spokenDollars(Number(savings.balance))} in savings.`;
        if (a.view === "balance") return { summary: balanceSummary, data: { balance: savings.balance } };
        const earned = savings.earned === null ? null : Number(savings.earned);
        const earnings = earned === null ? "Earnings are currently unavailable."
          : `You've ${earned < 0 ? "lost" : "earned"} ${spokenDollars(Math.abs(earned))}.`;
        if (a.view === "earnings") return { summary: earnings, data: { earned: savings.earned } };
        return { summary: `${balanceSummary} ${earnings}`, data: savings };
      },
    }),
    tool({
      name: "get_activity",
      kind: "read",
      description: "Recent money actions and their current statuses. Omit limit for the latest action in voice, or pass a count if the user asks for more history. Set show when they explicitly ask to open Activity on screen.",
      args: z.object({ limit: z.number().int().min(1).max(50).optional(), show: z.boolean().optional() }),
      stepLabel: () => "Checking your recent activity",
      run: async (ctx, a) => {
        if (ctx.channel === "voice" && a.show) return openScreen(svc, ctx, "activity");
        return readActivity(svc, ctx, a.limit ?? (ctx.channel === "voice" ? 1 : 10));
      },
    }),
    tool({
      name: "get_intent",
      kind: "read",
      description: "Check a transaction's status. With no ID, use the latest matching request in this conversation, or the latest matching account request. Set kind if the user specifies a send, swap, savings deposit or savings withdrawal.",
      args: z.object({ id: z.string().trim().min(1).optional(), kind: actionKind.optional() }),
      stepLabel: () => "Checking transaction status",
      run: async (ctx, a) => readIntent(svc, ctx, a),
    }),
  ];
}
