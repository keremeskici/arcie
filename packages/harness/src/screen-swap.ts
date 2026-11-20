import { getChain, type WalletRef } from "@arcie/appkit";
import { ArcieError, parseAmount, type ReceiptIsland, type TokenSymbol } from "@arcie/core";
import { parseUnits } from "viem";
import { prepareSwap } from "./actions.js";
import { audit } from "./audit.js";
import type { HarnessCtx } from "./context.js";
import type { ConfirmResult } from "./harness.js";
import { paramsHash } from "./intents/hash.js";
import type { Intent } from "./intents/repo.js";
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
  return { intentId, status: "executing", summary: intent.error?.message ?? "Your swap is processing." };
}

/** The screen's Swap tap approves the displayed floor. Claim it durably before contacting the execution provider. */
export async function screenSwap(
  svc: Svc,
  ctx: HarnessCtx,
  request: ScreenSwapRequest,
  execute: (ctx: HarnessCtx, intent: Intent, wallet: WalletRef, started: Date) => Promise<ConfirmResult>,
): Promise<ScreenSwapResult> {
  const { requestId, tokenIn, tokenOut, amountIn, minOut } = request;
  const fingerprint = paramsHash({ tokenIn, tokenOut, amountIn, minOut });
  const prior = svc.repo.get(requestId);
  if (prior) return priorResult(prior, ctx.userId, fingerprint);

  const started = ctx.now();
  const wallet = await walletFor(svc, ctx);
  const decimals = getChain(wallet.chain).tokens[tokenOut].decimals;
  const acceptedFloor = parseAmount(minOut, decimals);
  const prepared = await prepareSwap(svc, ctx, wallet, { tokenIn, tokenOut, amountIn });
  const limits = await svc.policy.getLimits(ctx.userId);

  const claim = svc.db.transaction(() => {
    const existing = svc.repo.get(requestId);
    if (existing) return { existing };
    const now = ctx.now();
    const params = { ...prepared.params };
    const denied = prepared.type === "rejected" ? prepared : checkLimits({
      action: "swap", token: tokenIn, tokenOut, usdValue: prepared.usdValue, limits,
      slippageBps: Number(params.slippageBps), spentTodayUsd: svc.repo.spentTodayUsd(ctx.userId, now),
    });
    const priceMoved = prepared.type === "ready" && parseUnits(String(prepared.preview.estimatedOut), decimals) < acceptedFloor;
    // A second quote may improve the rate, but it may never loosen either the user's floor or the platform limit.
    if (prepared.type === "ready" && parseUnits(String(params.minOut), decimals) < acceptedFloor) params.minOut = minOut;
    const statusReason = denied?.reason ?? (priceMoved ? "price_changed" : null);
    const preview = prepared.type === "ready" ? { ...prepared.preview, estimated: prepared.estimated } : {};
    const intent = svc.repo.create({
      id: requestId, sessionId: ctx.sessionId, userId: ctx.userId, kind: "swap", chain: wallet.chain,
      params, usdValue: String(prepared.usdValue), previewTurn: ctx.userTurn, now, ttlSec: null,
      preview: { ...preview, screenSwapKey: fingerprint },
      status: statusReason ? "rejected" : "executing", statusReason,
      confirmedVia: statusReason ? null : "screen",
      error: denied ? { code: denied.code, message: denied.reason } : null,
    });
    audit(svc.db, ctx, statusReason ? "intent.rejected" : "intent.confirmed", { kind: "swap", channel: "screen", minOut }, intent.id);
    if (statusReason) return { existing: intent };
    return { intent, superseded: svc.repo.supersedeOpen(ctx.sessionId, intent.id) };
  }, { behavior: "immediate" });

  if (claim.existing) return priorResult(claim.existing, ctx.userId, fingerprint);
  for (const id of claim.superseded) svc.bus.publish(ctx.sessionId, { kind: "dismiss", intentId: id, reason: "superseded" });
  return { intentId: requestId, ...await execute(ctx, claim.intent, wallet, started) };
}
