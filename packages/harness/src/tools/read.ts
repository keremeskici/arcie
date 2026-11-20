import { getChain, HOME_CHAIN } from "@arcie/appkit";
import { ArcieError, tokenName } from "@arcie/core";
import { contacts } from "@arcie/db";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { quoteSwap } from "../actions.js";
import { apyText } from "../disclosure/prompt.js";
import { balancesOf, joinNames, resolveRecipient, walletFor, type Svc } from "../services.js";
import { tool } from "./registry.js";

const token = z.enum(["USDC", "EURC", "cirBTC"]);
const isZero = (s: string) => /^0(\.0+)?$/.test(s);

const KIND_WORDS = { send: "sent", swap: "swapped", earn_deposit: "invested", earn_withdraw: "withdrew" } as const;

export function readTools(svc: Svc) {
  return [
    tool({
      name: "get_balances",
      kind: "read",
      description: "The user's token balances.",
      args: z.object({}),
      stepLabel: () => "Checking your balance",
      run: async (ctx) => {
        const w = await walletFor(svc, ctx);
        const balances = await svc.kit.getBalances(w);
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
        const island = { kind: "receive" as const, address: w.address, chain: w.chain, tokens: getChain(w.chain).capabilities.send };
        svc.bus.publish(ctx.sessionId, island);
        return { summary: "I've put your receive details on screen.", data: { chain: w.chain, tokens: island.tokens }, island };
      },
    }),
    tool({
      name: "find_contact",
      kind: "read",
      description: "Look up a contact by name.",
      args: z.object({ name: z.string().min(1) }),
      stepLabel: (a) => `Looking up ${a.name}`,
      run: async (ctx, a) => {
        const r = resolveRecipient(svc, ctx.userId, a.name);
        if (r.kind === "choice") return { summary: `I found ${joinNames(r.options.map((o) => o.label))}.`, data: { matches: r.options } };
        return { summary: `${r.recipient.label} is in your contacts.`, data: { matches: [{ label: r.recipient.label, address: r.recipient.address }] } };
      },
    }),
    tool({
      name: "list_contacts",
      kind: "read",
      description: "List the user's saved contacts.",
      args: z.object({}),
      stepLabel: () => "Opening your contacts",
      run: async (ctx) => {
        const rows = svc.db.select().from(contacts).where(eq(contacts.userId, ctx.userId)).all();
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
      args: z.object({ tokenIn: token, tokenOut: token, amountIn: z.string() }),
      stepLabel: (a) => `Checking the ${tokenName(a.tokenIn)} to ${tokenName(a.tokenOut)} price`,
      run: async (ctx, a) => {
        const w = await walletFor(svc, ctx);
        const limits = await svc.policy.getLimits(ctx.userId);
        const q = await quoteSwap(svc, w, a, limits.maxSlippageBps);
        return { summary: `${a.amountIn} ${tokenName(a.tokenIn)} gets you about ${q.estimatedOut} ${tokenName(a.tokenOut)} right now.`, data: q };
      },
    }),
    tool({
      name: "list_earn_vaults",
      kind: "read",
      description: "Earning vaults available, best APY first.",
      args: z.object({ token: z.enum(["USDC", "EURC"]).optional() }),
      stepLabel: () => "Finding places to earn",
      run: async (_ctx, a) => {
        const vaults = (await svc.kit.listVaults(HOME_CHAIN, a.token)).sort((x, y) => y.apy - x.apy);
        const best = vaults[0];
        return {
          summary: best ? `The best right now is ${best.name} at about ${apyText(best.apy)} APY.` : "There are no earning vaults available right now.",
          data: { vaults },
        };
      },
    }),
    tool({
      name: "get_earn_positions",
      kind: "read",
      description: "What the user currently has invested and how much it has earned.",
      args: z.object({}),
      stepLabel: () => "Checking your investments",
      run: async (ctx) => {
        const w = await walletFor(svc, ctx);
        const vaults = await svc.kit.listVaults(w.chain);
        const found = await Promise.all(vaults.map(async (v) => ({ v, p: await svc.kit.getPosition(w, v.address) })));
        const positions = found.filter((x) => x.p).map(({ v, p }) => ({ vault: v.address, token: v.token, ...p! }));
        const said = positions.map((p) => `${p.currentBalance} ${tokenName(p.token)} in ${p.vaultName} at about ${apyText(p.apy)}`);
        return { summary: said.length ? `You have ${joinNames(said)}.` : "You don't have any investments yet.", data: { positions } };
      },
    }),
    tool({
      name: "get_activity",
      kind: "read",
      description: "The user's recent money actions and their status.",
      args: z.object({ limit: z.number().int().min(1).max(50).optional() }),
      stepLabel: () => "Checking your recent activity",
      run: async (ctx, a) => {
        const rows = svc.repo.listForUser(ctx.userId, a.limit ?? 10).filter((i) => i.status === "succeeded" || i.status === "failed");
        const items = rows.map((i) => ({ intentId: i.id, kind: i.kind, status: i.status, params: i.params, txHash: i.txHash, at: i.updatedAt }));
        const last = rows[0];
        const lastText = last ? `${KIND_WORDS[last.kind]} ${String(last.params.amount ?? last.params.amountIn ?? "")} ${tokenName(String(last.params.token ?? last.params.tokenIn ?? ""))}`.trim() : "";
        return { summary: last ? `Most recently you ${lastText}${last.status === "failed" ? ", but it failed" : ""}.` : "No activity yet.", data: { items } };
      },
    }),
    tool({
      name: "get_intent",
      kind: "read",
      description: "Status of a specific request.",
      args: z.object({ id: z.string() }),
      stepLabel: () => "Checking that request",
      run: async (ctx, a) => {
        const i = svc.repo.get(a.id);
        if (!i || i.userId !== ctx.userId) throw new ArcieError("NOT_FOUND");
        return { summary: `That request is ${i.status.replace(/_/g, " ")}.`, data: { id: i.id, kind: i.kind, status: i.status, txHash: i.txHash } };
      },
    }),
  ];
}
