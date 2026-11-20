import { getChain } from "@arcie/appkit";
import { parseAmount, type IslandPayload } from "@arcie/core";
import { z } from "zod";
import type { HarnessCtx } from "../context.js";
import { walletFor, type Svc } from "../services.js";
import { tool } from "./registry.js";

export function onrampTools(svc: Svc) {
  return [
    tool({
      name: "start_onramp",
      kind: "action",
      description: "Open the add-money iframe when the user wants to deposit or add money. Amount is optional. This only opens checkout; the user completes identity checks and payment on screen, never by voice.",
      args: z.object({ amount: z.string().optional(), token: z.enum(["USDC", "EURC"]).default("USDC") }),
      stepLabel: () => "Opening add money",
      run: async (ctx, a) => {
        const w = await walletFor(svc, ctx);
        if (a.amount !== undefined) parseAmount(a.amount, getChain(w.chain).tokens[a.token].decimals);
        const s = await svc.kit.createOnrampSession({
          appUserId: ctx.userId,
          destinationAddress: w.address,
          token: a.token,
          ...(a.amount ? { amount: a.amount } : {}),
        });
        const island: IslandPayload = {
          kind: "onramp",
          ...s,
          ...(ctx.onrampRequestId ? { requestId: ctx.onrampRequestId } : {}),
          destinationAddress: w.address,
          token: a.token,
          ...(a.amount ? { amount: a.amount } : {}),
        };
        await svc.events.publish(ctx.sessionId, island);
        return {
          summary: "I've opened the add-money screen. Complete your deposit there.",
          data: { expiresAt: s.expiresAt },
          island,
        };
      },
    }),
  ];
}

/** Lifecycle events forwarded by the client from the onramp widget. */
export async function recordOnrampEvent(
  svc: Svc,
  ctx: HarnessCtx,
  e: { type: "submitted" | "settled" | "failed"; payload: unknown },
  audit: (type: string, payload: object) => Promise<void>,
): Promise<void> {
  await audit(`onramp.${e.type}`, { payload: e.payload ?? null });
  // Browser reports are hints, not proof of a deposit. Always read balances from the chain.
  if (e.type !== "settled" && e.type !== "submitted") return;
  const w = await walletFor(svc, ctx);
  await svc.events.publish(ctx.sessionId, { kind: "balances", chain: w.chain, balances: await svc.kit.getBalances(w) });
}
