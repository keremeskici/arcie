import { getChain, type WalletRef } from "@arcie/appkit";
import { ArcieError, parseAmount, type ReceiptIsland, type TokenSymbol } from "@arcie/core";
import { sql } from "drizzle-orm";
import { parseUnits } from "viem";
import { prepareSwap } from "./actions.js";
import { audit } from "./audit.js";
import { activeContactChoice, closeContactChoice } from "./contact-choices.js";
import type { HarnessCtx } from "./context.js";
import { guardSession, invalidateProposals, lockSessionState, lockUserBudget } from "./coordination.js";
import type { ConfirmResult } from "./harness.js";
import { paramsHash } from "./intents/hash.js";
import { IntentRepo, QUOTE_FRESH_MS, savedProcessing, type Intent } from "./intents/repo.js";
import { checkLimits } from "./policy/check.js";
import { walletFor, type Svc } from "./services.js";

export interface ScreenSwapRequest {
  requestId: string;
  tokenIn: TokenSymbol;
  tokenOut: TokenSymbol;
  amountIn: string;
  minOut: string;
}

export type ScreenSwapResult = { intentId: string; status: ConfirmResult["status"] | "requote"; summary: string; island?: ConfirmResult["island"] };

function priorResult(intent: Intent, userId: string, fingerprint: string): ScreenSwapResult {
  if (intent.userId !== userId || intent.preview?.screenSwapKey !== fingerprint) {
    throw new ArcieError("POLICY_DENIED", { spoken: "This swap request ID is already in use." });
  }
  const intentId = intent.id;
  if (intent.status === "rejected") {
    if (intent.statusReason === "price_changed") {
      return { intentId, status: "requote", summary: "The price changed. Check the new estimate and tap Swap again." };
    }
    throw new ArcieError(intent.error?.code === "INSUFFICIENT_BALANCE" ? "INSUFFICIENT_BALANCE" : "POLICY_DENIED",
      { spoken: intent.statusReason ?? "This swap exceeds your limits." });
  }
  const receipt = intent.preview?.receipt as ReceiptIsland | undefined;
  if (receipt) return { intentId, status: intent.status, summary: receipt.error?.message ?? "Swap complete.", island: receipt };
  const island = savedProcessing(intent);
  return { intentId, status: "executing", summary: intent.error?.message ?? "Your swap is processing.", ...(island ? { island } : {}) };
}

/** The screen's Swap tap approves the displayed floor. Claim it durably before contacting the execution provider. */
export async function screenSwap(
  svc: Svc,
  ctx: HarnessCtx,
  request: ScreenSwapRequest,
  execute: (ctx: HarnessCtx, intent: Intent, wallet: WalletRef, started: Date) => Promise<ConfirmResult>,
): Promise<ScreenSwapResult> {
  if (ctx.channel !== "screen") throw new ArcieError("POLICY_DENIED", { spoken: "Tap Swap on screen to finish." });
  const { requestId, tokenIn, tokenOut, amountIn, minOut } = request;
  const fingerprint = paramsHash({ tokenIn, tokenOut, amountIn, minOut });
  const prior = await svc.repo.get(requestId);
  if (prior) return priorResult(prior, ctx.userId, fingerprint);

  const started = ctx.now();
  const wallet = await walletFor(svc, ctx);
  const decimals = getChain(wallet.chain).tokens[tokenOut].decimals;
  const acceptedFloor = parseAmount(minOut, decimals);
  const prepared = await prepareSwap(svc, ctx, wallet, { tokenIn, tokenOut, amountIn });

  const claim = await svc.db.transaction(async (tx) => {
    await lockUserBudget(tx, ctx.userId);
    const repo = new IntentRepo(tx);
    const existing = await repo.get(requestId);
    if (existing) return { intent: existing, execute: false };
    await lockSessionState(tx, ctx.sessionId);
    const previewTurn = await guardSession(tx, ctx);
    if (ctx.signal?.aborted) throw new ArcieError("NOT_FOUND", { spoken: "That request was interrupted. Nothing new was submitted." });
    const now = ctx.now();
    const params = { ...prepared.params };
    const denied = prepared.type === "rejected" ? prepared : checkLimits({
      action: "swap", token: tokenIn, tokenOut, usdValue: prepared.usdValue,
      limits: await svc.policy.getLimits(ctx.userId, tx),
      slippageBps: Number(params.slippageBps), spentTodayUsd: await repo.spentTodayUsd(ctx.userId, now),
    });
    const [freshness] = await tx.execute<{ stale: boolean }>(sql`select
      ${started.toISOString()}::timestamptz < clock_timestamp() - ${QUOTE_FRESH_MS} * interval '1 millisecond' as stale`);
    const priceMoved = prepared.type === "ready"
      && (freshness?.stale || parseUnits(String(prepared.preview.estimatedOut), decimals) < acceptedFloor);
    // A second quote may improve the rate, but it may never loosen either the user's floor or the platform limit.
    if (prepared.type === "ready" && parseUnits(String(params.minOut), decimals) < acceptedFloor) params.minOut = minOut;
    const statusReason = denied?.reason ?? (priceMoved ? "price_changed" : null);
    const preview = prepared.type === "ready" ? { ...prepared.preview, estimated: prepared.estimated } : {};
    if (ctx.signal?.aborted) throw new ArcieError("NOT_FOUND", { spoken: "That request was interrupted. Nothing new was submitted." });
    const intent = await repo.createIfAbsent({
      id: requestId, sessionId: ctx.sessionId, userId: ctx.userId, kind: "swap", chain: wallet.chain,
      params, usdValue: String(prepared.usdValue), previewTurn, now, ttlSec: null,
      preview: { ...preview, screenSwapKey: fingerprint },
      status: statusReason ? "rejected" : "executing", statusReason,
      confirmedVia: statusReason ? null : "screen",
      error: denied ? { code: denied.code, message: denied.reason } : null,
    });
    // Different accounts have different budget locks. The primary key claims a request ID globally.
    if (!intent) return { intent: (await repo.get(requestId))!, execute: false };
    await audit(tx, ctx, statusReason ? "intent.rejected" : "intent.confirmed", { kind: "swap", channel: "screen", minOut }, intent.id);
    if (statusReason) return { intent, execute: false };
    await invalidateProposals(tx, ctx.sessionId);
    const choice = await activeContactChoice(tx, ctx.sessionId, now, ctx.userId);
    if (choice) await closeContactChoice(tx, svc.events, ctx, choice.id);
    for (const id of await repo.supersedeOpen(ctx.sessionId, intent.id)) {
      await svc.events.append(tx, ctx.sessionId, { kind: "dismiss", intentId: id, reason: "superseded" });
    }
    return { intent, execute: true };
  });

  if (!claim.execute) return priorResult(claim.intent, ctx.userId, fingerprint);
  return { intentId: requestId, ...await execute(ctx, claim.intent, wallet, started) };
}
