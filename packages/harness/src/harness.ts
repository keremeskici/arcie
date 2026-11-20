import type { WalletRef } from "@arcie/appkit";
import { ArcieError, type ActionKind, type Channel, type ChoiceIsland, type IslandPayload, type TokenSymbol, tokenName } from "@arcie/core";
import { choices, type DbOrTx, type Tx } from "@arcie/db";
import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { parseUnits } from "viem";
import { ACTIONS, swapIsland, type SwapArgs } from "./actions.js";
import { audit } from "./audit.js";
import { activeContactChoice, closeContactChoice, contactChoiceIsland, matchContactChoice, noContactChoice } from "./contact-choices.js";
import type { HarnessCtx } from "./context.js";
import { beginProposal, cancelUnderLock, claimConfirmation, claimExecution, finishProposal, guardSession, invalidateProposals, lockConfirmRows, lockSessionState, publishProposal, releaseConfirmation } from "./coordination.js";
import { CONFIRM_INSTRUCTION } from "./disclosure/prompt.js";
import { buildReceipt, nextStepFor } from "./disclosure/receipt.js";
import { StepTracker } from "./events.js";
import { paramsHash } from "./intents/hash.js";
import { assertConfirmable } from "./intents/machine.js";
import { IntentRepo, QUOTE_FRESH_MS, savedCard, savedProcessing, type Intent, type IntentStatus } from "./intents/repo.js";
import { checkLimits } from "./policy/check.js";
import { screenSwap, type ScreenSwapRequest, type ScreenSwapResult } from "./screen-swap.js";
import { balancesOf, countWord, joinNames, walletFor, type Svc } from "./services.js";
import { controlTools } from "./tools/control.js";
import { onrampTools, recordOnrampEvent } from "./tools/onramp.js";
import { legacyEarnArgs, proposeTools } from "./tools/propose.js";
import { readSwapQuote, readTools } from "./tools/read.js";
import type { ToolDef, ToolResult } from "./tools/registry.js";

const TTL_SEC = 120;
type Claim = { token: string; revision: number };
const STALE_CONSENT = "The details changed. Please check the new card and confirm again.";
const SCREEN_ONLY = "Tap confirm on the card to finish.";
const reviewSummary = (spokenPrompt: string, tapOnly: boolean) =>
  tapOnly ? spokenPrompt.slice(0, -CONFIRM_INSTRUCTION.length) + SCREEN_ONLY : spokenPrompt;

export type ConfirmResult = { status: IntentStatus; summary: string; island?: IslandPayload };

export interface Harness {
  tools: ToolDef<any>[];
  intents: IntentRepo;
  quoteSwap(ctx: HarnessCtx, params: SwapArgs): ReturnType<typeof readSwapQuote>;
  screenSwap(ctx: HarnessCtx, request: ScreenSwapRequest): Promise<ScreenSwapResult>;
  runTool(ctx: HarnessCtx, name: string, rawArgs: unknown): Promise<ToolResult>;
  propose(ctx: HarnessCtx, kind: ActionKind, params: unknown): Promise<ToolResult>;
  confirm(ctx: HarnessCtx, intentId: string | undefined, channel: Channel, revision?: number): Promise<ConfirmResult>;
  cancel(ctx: HarnessCtx, intentId?: string): Promise<ToolResult>;
  pendingChoice(sessionId: string, now: Date): Promise<ChoiceIsland | null>;
  answerChoice(ctx: HarnessCtx, choiceId: string, optionId: string): Promise<void>;
  prepareChoice(ctx: HarnessCtx, choiceId: string, optionId: string): Promise<ToolResult>;
  dismissChoice(ctx: HarnessCtx, choiceId: string): Promise<void>;
  recordOnrampEvent(ctx: HarnessCtx, e: { type: "submitted" | "settled" | "failed"; payload: unknown }): Promise<void>;
}

export function createHarness(deps: Omit<Svc, "repo" | "confirmChannels"> & { confirmChannels?: "any" | "screen" }): Harness {
  const svc: Svc = { ...deps, repo: new IntentRepo(deps.db), confirmChannels: deps.confirmChannels ?? "any" };
  const { repo, events, db } = svc;
  const trackers = new Map<string, StepTracker>();

  const assertActive = (ctx: HarnessCtx) => {
    if (ctx.signal?.aborted) throw new ArcieError("NOT_FOUND", { spoken: "That request was interrupted. Nothing new was submitted." });
  };

  const guarded = async <T>(tx: Tx, ctx: HarnessCtx, fn: () => Promise<T>) => {
    const result = await fn();
    await guardSession(tx, ctx);
    assertActive(ctx);
    return result;
  };

  const tracker = (ctx: HarnessCtx) => {
    let t = trackers.get(ctx.runId);
    if (!t) {
      t = new StepTracker(events, ctx);
      trackers.set(ctx.runId, t);
      if (trackers.size > 500) trackers.delete(trackers.keys().next().value!);
    }
    return t;
  };

  /**
   * Moves an intent between statuses and appends its island in ONE transaction. The event is appended first so
   * the session_state row lock is taken before the intent row lock (the order publishProposal and cancel use);
   * a lost compare-and-set rolls the event back with it. Returns whether this call made the transition.
   */
  async function transitionWithEvent(sessionId: string, intentId: string, from: IntentStatus, to: IntentStatus, patch: Parameters<IntentRepo["transition"]>[3], island: IslandPayload, after?: (tx: Tx) => Promise<void>, observed?: { txHash: string | null; revision?: number }): Promise<boolean> {
    const lost = new Error("transition lost");
    try {
      await db.transaction(async (tx) => {
        await events.append(tx, sessionId, island);
        if (!(await new IntentRepo(tx).transition(intentId, from, to, patch, observed))) throw lost;
        await after?.(tx);
      });
      return true;
    } catch (e) {
      if (e === lost) return false;
      throw e;
    }
  }

  async function storedResult(id: string): Promise<ConfirmResult> {
    const row = await repo.get(id);
    if (!row) throw new ArcieError("NOT_FOUND");
    const island = (row.status === "awaiting_confirmation" ? savedCard(row)
      : savedProcessing(row) ?? row.preview?.receipt) as IslandPayload | undefined;
    const summary = row.error?.message ?? (row.status === "succeeded" ? "Your transaction completed." :
      row.status === "executing" ? "Your transaction is processing." : `This request is ${row.status.replaceAll("_", " ")}.`);
    return { status: row.status, summary, ...(island ? { island } : {}) };
  }

  const dismiss = (tx: DbOrTx, ctx: HarnessCtx, intentId: string, reason: "cancelled" | "superseded" | "expired") =>
    events.append(tx, ctx.sessionId, { kind: "dismiss", intentId, reason });

  async function propose(ctx: HarnessCtx, kind: ActionKind, params: unknown, selection?: { choiceId: string; optionId: string }): Promise<ToolResult> {
    assertActive(ctx);
    const schema = kind === "earn_deposit" || kind === "earn_withdraw"
      ? legacyEarnArgs[kind]
      : tools.find((t) => t.name === `propose_${kind}`)?.args;
    const parsed = schema?.safeParse(params);
    if (!parsed?.success) return { summary: "I didn't quite catch that. Could you check the action details?", data: { error: "INVALID_ARGS" } };
    const generation = await db.transaction((tx) => guarded(tx, ctx, () => beginProposal(tx, ctx.sessionId)));
    const replaced: ToolResult = { summary: "That preparation was cancelled or replaced.", data: { cancelled: true } };
    try {
      const w = await walletFor(svc, ctx);
      const prep = await ACTIONS[kind].prepare(svc, ctx, w, parsed.data as never);
      assertActive(ctx);
      const published = await publishProposal<ToolResult>(db, ctx.sessionId, generation, async (tx) => {
        const previewTurn = await guardSession(tx, ctx);
        assertActive(ctx);
        const now = ctx.now();
        const txRepo = new IntentRepo(tx);
        const previous = await activeContactChoice(tx, ctx.sessionId, now, ctx.userId);
        if (selection && previous?.id !== selection.choiceId) throw noContactChoice();
        const base = { sessionId: ctx.sessionId, userId: ctx.userId, kind, chain: w.chain, previewTurn, now, ttlSec: TTL_SEC };

        if (prep.type === "rejected") {
          const rejected = await txRepo.create({ ...base, usdValue: String(prep.usdValue), params: prep.params, preview: {}, status: "rejected", statusReason: prep.reason });
          await audit(tx, ctx, "intent.rejected", { kind, code: prep.code, reason: prep.reason }, rejected.id);
          return { summary: prep.reason, data: { error: prep.code, intentId: rejected.id } };
        }

        if (previous) {
          const closed = await closeContactChoice(tx, events, ctx, previous.id, selection?.optionId);
          if (selection && !closed) throw noContactChoice();
        }
        if (prep.type === "choice") {
          const id = randomUUID();
          for (const old of await txRepo.supersedeOpen(ctx.sessionId)) await dismiss(tx, ctx, old, "superseded");
          const [choice] = await tx.insert(choices).values({
            id, sessionId: ctx.sessionId, userId: ctx.userId, question: prep.question, options: prep.options,
            send: prep.send, previewTurn, createdAt: now.toISOString(),
            expiresAt: new Date(now.getTime() + TTL_SEC * 1000).toISOString(),
          }).returning();
          const island = contactChoiceIsland(choice!);
          await events.append(tx, ctx.sessionId, island);
          assertActive(ctx);
          const names = prep.options.map((o) => o.label);
          return { summary: `I found ${countWord(names.length)} contacts: ${joinNames(names)}. Which one?`, data: { choiceId: id, options: prep.options }, island };
        }

        // Supersede the older card before inserting: Postgres permits only one awaiting intent per session.
        const id = randomUUID();
        for (const old of await txRepo.supersedeOpen(ctx.sessionId, id)) await dismiss(tx, ctx, old, "superseded");
        const created = await txRepo.create({ ...base, id, usdValue: String(prep.usdValue), params: { ...prep.params, requireScreen: prep.requireScreen }, preview: prep.preview, status: "awaiting_confirmation" });
        const island = { ...prep.buildIsland(created.id, created.expiresAt!), revision: created.revision + 1 };
        await txRepo.patch(created.id, { preview: { ...prep.preview, originalDisclosure: true, island, estimated: prep.estimated } });
        if (selection) await audit(tx, ctx, "choice.answered", selection);
        await audit(tx, ctx, "intent.proposed", { kind, params: prep.params, usdValue: prep.usdValue }, created.id);
        await events.append(tx, ctx.sessionId, island);
        assertActive(ctx);
        const summary = reviewSummary(island.spokenPrompt, svc.confirmChannels === "screen" || prep.requireScreen);
        return { summary, data: { intentId: created.id }, island };
      });
      return published ?? replaced;
    } finally {
      await finishProposal(db, ctx.sessionId, generation);
    }
  }

  /** Swap quotes older than 30s are re-checked; a drop beyond the slippage cap sends the user back to the card. */
  async function refreshIfStale(ctx: HarnessCtx, intent: Intent, claim: Claim): Promise<ConfirmResult | null> {
    if (intent.kind !== "swap" || !intent.quoteAt) return null;
    const now = ctx.now();
    if (now.getTime() - new Date(intent.quoteAt).getTime() <= QUOTE_FRESH_MS) return null;
    const w = await walletFor(svc, ctx, intent.chain);
    const p = intent.params as { tokenIn: "USDC"; tokenOut: "EURC"; amountIn: string; slippageBps: number };
    const est = await svc.kit.estimateSwap(w, p);
    assertActive(ctx);
    // Cancellation/supersession may have happened while the provider was answering.
    assertConfirmable(await repo.get(intent.id), { channel: ctx.channel, userTurn: ctx.userTurn, now: ctx.now() });
    const decimals = 18; // comparison only; parseUnits is exact for any shorter decimal string
    const oldOut = parseUnits(String(intent.preview?.estimatedOut ?? "0"), decimals);
    const floor = (oldOut * BigInt(10_000 - p.slippageBps)) / 10_000n;
    if (parseUnits(est.estimatedOut, decimals) >= floor) {
      const fresh = await db.transaction(async (tx) => {
        await lockConfirmRows(tx, intent.id, claim.token);
        await guardSession(tx, ctx);
        return new IntentRepo(tx).touchFenced(intent.id, claim, { quoteAt: now.toISOString() });
      });
      if (!fresh) throw new ArcieError("POLICY_DENIED", { spoken: STALE_CONSENT });
      return null;
    }
    const expiresAt = new Date(now.getTime() + TTL_SEC * 1000).toISOString();
    const island = { ...swapIsland(intent.id, p, est, ["The price moved; here's the updated quote."], expiresAt), revision: claim.revision + 1 };
    const params = { ...intent.params, minOut: est.minOut };
    // One transaction: the new quote and its card commit together or not at all. The event is appended first
    // (session_state lock before the intent row, the order publish/cancel use); a failed fence rolls it back.
    const stale = new Error("stale consent");
    const written = await db.transaction(async (tx) => {
      await events.append(tx, ctx.sessionId, island);
      await lockConfirmRows(tx, intent.id, claim.token);
      const previewTurn = await guardSession(tx, ctx);
      const ok = await new IntentRepo(tx).patchFenced(intent.id, claim, {
        params,
        paramsHash: paramsHash(params),
        preview: { estimatedOut: est.estimatedOut, minOut: est.minOut, fees: est.fees, island, estimated: { "You got": `${est.estimatedOut} ${tokenName(p.tokenOut)}` } },
        quoteAt: now.toISOString(),
        previewTurn,
        expiresAt,
      });
      if (!ok) throw stale;
      await audit(tx, ctx, "intent.requoted", { estimatedOut: est.estimatedOut }, intent.id);
      return true;
    }).catch((e) => {
      if (e === stale) return false;
      throw e;
    });
    // Cancelled, superseded, expired or revised while the provider answered: this consent is stale.
    if (!written) throw new ArcieError("POLICY_DENIED", { spoken: STALE_CONSENT });
    const summary = reviewSummary(island.spokenPrompt, svc.confirmChannels === "screen" || intent.params.requireScreen === true);
    return { status: "awaiting_confirmation", summary: `The price changed. ${summary}`, island };
  }

  async function confirm(ctx: HarnessCtx, intentId: string | undefined, channel: Channel, revision?: number): Promise<ConfirmResult> {
    assertActive(ctx);
    const candidate = intentId ? await repo.get(intentId) : await repo.latestAwaiting(ctx.sessionId);
    if (!candidate || candidate.userId !== ctx.userId || candidate.sessionId !== ctx.sessionId) {
      const choice = !intentId && await activeContactChoice(db, ctx.sessionId, ctx.now(), ctx.userId);
      throw new ArcieError("NOT_FOUND", { spoken: choice ? "Choose a recipient first." : "There's nothing waiting for your confirmation right now." });
    }
    // The claim is shared through the database, so a second instance (or tab) can't act on this confirmation.
    const claim = await claimConfirmation(db, candidate.id);
    if (!claim) {
      const stored = await storedResult(candidate.id);
      return stored.status === "awaiting_confirmation" || stored.status === "executing"
        ? { ...stored, summary: "I'm already checking that confirmation." } : stored;
    }
    try {
      return await confirmOnce(ctx, candidate.id, channel, claim, revision);
    } finally {
      await releaseConfirmation(db, candidate.id, claim.token);
    }
  }

  async function confirmOnce(ctx: HarnessCtx, intentId: string, channel: Channel, claim: Claim, displayedRevision?: number): Promise<ConfirmResult> {
    const started = ctx.now();
    let intent = intentId ? await repo.get(intentId) : await repo.latestAwaiting(ctx.sessionId);
    if (intent && (intent.userId !== ctx.userId || intent.sessionId !== ctx.sessionId)) intent = null;

    try {
      assertConfirmable(intent, { channel, userTurn: ctx.userTurn, now: started });
    } catch (e) {
      if (e instanceof ArcieError && e.code === "QUOTE_EXPIRED" && intent?.status === "awaiting_confirmation") {
        await transitionWithEvent(ctx.sessionId, intent.id, "awaiting_confirmation", "expired", {},
          { kind: "dismiss", intentId: intent.id, reason: "expired" }, async (tx) => {
            await guardSession(tx, ctx);
            assertActive(ctx);
          }, { txHash: null, revision: intent.revision });
      }
      throw e;
    }
    if (channel === "screen") {
      const originalCard = !ctx.sessionGuard && intent.preview?.originalDisclosure === true && intent.revision === 1;
      if (displayedRevision === undefined ? !originalCard : displayedRevision !== intent.revision || displayedRevision !== claim.revision) {
        const island = savedCard(intent);
        return { status: "awaiting_confirmation", summary: STALE_CONSENT, ...(island ? { island } : {}) };
      }
    }
    if (paramsHash(intent.params) !== intent.paramsHash) throw new ArcieError("UNKNOWN", { detail: { tampered: intent.id } });

    const needsScreen = svc.confirmChannels === "screen" || intent.params.requireScreen === true;
    if (needsScreen && channel !== "screen") return { status: "awaiting_confirmation", summary: SCREEN_ONLY };

    const requoted = await refreshIfStale(ctx, intent, claim);
    if (requoted) return requoted;

    // The budget lock, fresh limits, usage and execution claim share one transaction. Executing
    // intents reserve their budget even when settlement is still unknown.
    const w = await walletFor(svc, ctx, intent.chain);
    assertActive(ctx);
    const claimed = await db.transaction((tx) => claimExecution(tx, {
      intentId: intent.id, userId: ctx.userId, token: claim.token, revision: claim.revision,
      paramsHash: intent.paramsHash, channel, userTurn: ctx.userTurn, ctx, policy: svc.policy,
      check: (currentLimits, spentTodayUsd) => {
        assertActive(ctx);
        const denied = checkLimits({
          action: intent.kind,
          token: (intent.params.tokenIn ?? intent.params.token) as TokenSymbol,
          ...(intent.kind === "swap" ? { tokenOut: intent.params.tokenOut as TokenSymbol } : {}),
          usdValue: intent.kind === "earn_withdraw" ? 0 : Number(intent.usdValue),
          limits: currentLimits,
          spentTodayUsd,
          ...(typeof intent.params.slippageBps === "number" ? { slippageBps: intent.params.slippageBps } : {}),
        });
        if (denied) throw new ArcieError(denied.code, { spoken: denied.reason });
      },
      onClaim: async (tx) => {
        await audit(tx, ctx, "intent.confirmed", { channel }, intent.id);
        await events.append(tx, ctx.sessionId, { kind: "processing", intentId: intent.id });
      },
    }));
    if (claimed === "stale_quote") {
      const current = await storedResult(intent.id);
      return { ...current, summary: "The quote aged while I was checking. Please confirm again to refresh it." };
    }
    if (claimed === "screen_only") return { status: "awaiting_confirmation", summary: SCREEN_ONLY };
    if (!claimed) return storedResult(intent.id);
    return executeClaimed(ctx, intent, w, started);
  }

  async function executeClaimed(ctx: HarnessCtx, intent: Intent, w: WalletRef, started: Date): Promise<ConfirmResult> {
    const estimated = (intent.preview?.estimated ?? {}) as Record<string, string | null>;
    const elapsed = () => ctx.now().getTime() - started.getTime();
    const finishFailure = async (err: ArcieError, txHash: string | null, explorerUrl?: string): Promise<ConfirmResult> => {
      const receipt = buildReceipt({ intentId: intent.id, status: "failed", estimated, actual: {}, elapsedMs: elapsed(), error: err,
        ...(txHash ? { txHash } : {}), ...(explorerUrl ? { explorerUrl } : {}) });
      const won = await transitionWithEvent(ctx.sessionId, intent.id, "executing", "failed", {
        actuals: {}, statusReason: null, error: { code: err.code, message: err.spoken }, preview: { ...intent.preview, receipt },
      }, receipt, (tx) => audit(tx, ctx, "intent.failed", { code: err.code }, intent.id), { txHash });
      return won ? { status: "failed", summary: err.spoken, island: receipt } : storedResult(intent.id);
    };
    let ex: Awaited<ReturnType<typeof ACTIONS.send.execute>>;
    try {
      ex = await ACTIONS[intent.kind].execute(svc, w, intent.params);
    } catch (e) {
      const err = e instanceof ArcieError ? e : new ArcieError("UNKNOWN");
      if (!["UNKNOWN", "RPC_UNAVAILABLE", "CIRCLE_API_ERROR"].includes(err.code)) return finishFailure(err, null);
      const summary = "I couldn't verify that transaction. Please check your activity before trying again.";
      const island = { kind: "processing", intentId: intent.id, unverified: true, summary } as const;
      const won = await transitionWithEvent(ctx.sessionId, intent.id, "executing", "executing",
        { statusReason: "submission_unknown", error: { code: err.code, message: summary } },
        island, (tx) => audit(tx, ctx, "intent.uncertain", { code: err.code }, intent.id), { txHash: null });
      return won ? { status: "executing", summary, island } : storedResult(intent.id);
    }

    // Commit submission evidence before any further network read. Only settlement can replace unknown actuals.
    const txHash = ex.tx.txHash;
    const recorded = await repo.transition(intent.id, "executing", "executing", { txHash, statusReason: null, error: null }, { txHash: null });
    if (!recorded) return storedResult(intent.id);
    if (ex.tx.status === "PENDING") {
      if (intent.kind === "swap") {
        const settled = await svc.kit.waitForSwap(w, txHash, 20_000).catch(() => null);
        if (settled && settled.txHash === txHash) {
          ex.tx = settled;
          const out = settled.amountOut ? `${settled.amountOut} ${tokenName(String(intent.params.tokenOut))}` : null;
          ex.actual = { "You got": out };
          ex.summary = out ? `Done. You got ${out}.` : "Your swap completed. Check the receipt for details.";
        }
      } else ex.tx.status = await svc.kit.readTransaction(w.chain, txHash, 3_000).catch(() => "PENDING" as const);
    }
    if (ex.tx.status === "FAILED") {
      return finishFailure(new ArcieError("UNKNOWN", { spoken: "That transaction failed onchain. Check your activity for details." }), txHash, ex.tx.explorerUrl);
    }
    if (ex.tx.status === "PENDING") {
      const summary = "It's processing. I'll show the receipt when it lands.";
      const won = await transitionWithEvent(ctx.sessionId, intent.id, "executing", "executing", {},
        { kind: "processing", intentId: intent.id, summary }, (tx) => audit(tx, ctx, "intent.pending", { txHash }, intent.id), { txHash });
      return won ? { status: "executing", summary } : storedResult(intent.id);
    }
    const balances = await balancesOf(svc, w).catch(() => null);
    const nextStep = nextStepFor(intent.kind, intent.params as { tokenOut?: string });
    const receipt = buildReceipt({ intentId: intent.id, status: "succeeded", estimated, actual: ex.actual,
      txHash, explorerUrl: ex.tx.explorerUrl, elapsedMs: elapsed(),
      ...(balances ? { newBalance: `${balances[ex.balanceToken]} ${tokenName(ex.balanceToken)}` } : {}),
      ...(nextStep ? { nextStep } : {}),
    });
    const won = await transitionWithEvent(ctx.sessionId, intent.id, "executing", "succeeded",
      { actuals: ex.actual, preview: { ...intent.preview, receipt }, statusReason: null, error: null }, receipt,
      (tx) => audit(tx, ctx, "intent.succeeded", { txHash, actual: ex.actual }, intent.id), { txHash });
    return won ? { status: "succeeded", summary: ex.summary, island: receipt } : storedResult(intent.id);
  }

  async function cancel(ctx: HarnessCtx, intentId?: string): Promise<ToolResult> {
    assertActive(ctx);
    if (intentId) {
      const named = await repo.get(intentId);
      if (!named || named.userId !== ctx.userId || named.sessionId !== ctx.sessionId) throw new ArcieError("NOT_FOUND");
    }
    // Bump the generation and cancel the card under one session lock, so a concurrent publish can't slip a card in between.
    return cancelUnderLock(db, ctx.sessionId, (tx, preparing) => guarded(tx, ctx, async () => {
      const txRepo = new IntentRepo(tx);
      const choice = !intentId && await activeContactChoice(tx, ctx.sessionId, ctx.now(), ctx.userId);
      if (choice && await closeContactChoice(tx, events, ctx, choice.id)) {
        await audit(tx, ctx, "choice.cancelled", { choiceId: choice.id });
        return { summary: "I cancelled the send. No money moved.", data: { cancelled: true, choiceId: choice.id } };
      }
      const intent = intentId ? await txRepo.get(intentId) : await txRepo.latestAwaiting(ctx.sessionId);
      if (intent && intent.userId === ctx.userId && intent.status === "awaiting_confirmation"
        && await txRepo.transition(intent.id, "awaiting_confirmation", "cancelled", { statusReason: "user" })) {
        await audit(tx, ctx, "intent.cancelled", {}, intent.id);
        await dismiss(tx, ctx, intent.id, "cancelled");
        return { summary: "Okay, I cancelled that. Nothing was moved.", data: { cancelled: true, intentId: intent.id } };
      }
      return { summary: preparing ? "Okay, I stopped preparing that. Nothing was moved." : "There's nothing to cancel.", data: { cancelled: preparing } };
    }));
  }

  async function answerChoice(ctx: HarnessCtx, choiceId: string, optionId: string): Promise<void> {
    assertActive(ctx);
    await db.transaction((tx) => guarded(tx, ctx, async () => {
      await lockSessionState(tx, ctx.sessionId);
      const [choice] = await tx.select().from(choices).where(eq(choices.id, choiceId)).limit(1);
      if (!choice || choice.sessionId !== ctx.sessionId || (choice.userId !== null && choice.userId !== ctx.userId)
          || !choice.options.some((o) => o.id === optionId)) {
        throw new ArcieError("NOT_FOUND", { spoken: "I couldn't find that option." });
      }
      if (choice.selectedOptionId === optionId) return;
      if (choice.userId !== null) {
        const active = await activeContactChoice(tx, ctx.sessionId, ctx.now(), ctx.userId);
        if (active?.id !== choiceId || !await closeContactChoice(tx, events, ctx, choiceId, optionId)) throw noContactChoice();
      } else {
        await tx.update(choices).set({ selectedOptionId: optionId }).where(eq(choices.id, choiceId));
      }
      await audit(tx, ctx, "choice.answered", { choiceId, optionId });
    }));
  }

  async function dismissChoice(ctx: HarnessCtx, choiceId: string): Promise<void> {
    assertActive(ctx);
    await db.transaction((tx) => guarded(tx, ctx, async () => {
      await lockSessionState(tx, ctx.sessionId);
      if (await closeContactChoice(tx, events, ctx, choiceId)) {
        await invalidateProposals(tx, ctx.sessionId);
        await audit(tx, ctx, "choice.cancelled", { choiceId });
      }
    }));
  }

  async function prepareChoice(ctx: HarnessCtx, choiceId: string, optionId: string): Promise<ToolResult> {
    assertActive(ctx);
    const choice = await activeContactChoice(db, ctx.sessionId, ctx.now(), ctx.userId);
    if (!choice?.send || choice.id !== choiceId || !choice.options.some((o) => o.id === optionId)) throw noContactChoice();
    if (ctx.channel !== "screen" && choice.previewTurn !== null && ctx.userTurn <= choice.previewTurn) {
      throw new ArcieError("POLICY_DENIED", { spoken: "Choose a recipient after seeing or hearing the options." });
    }
    return propose(ctx, "send", { ...choice.send, to: optionId }, { choiceId, optionId });
  }

  async function chooseContact(ctx: HarnessCtx, selection: string): Promise<ToolResult> {
    const choice = await activeContactChoice(db, ctx.sessionId, ctx.now(), ctx.userId);
    if (!choice) throw noContactChoice();
    const option = matchContactChoice(choice.options, selection);
    if (!option) {
      const summary = choice.options.length <= 2
        ? `Choose ${choice.options.map((o) => o.label).join(" or ")}.`
        : "Say a name or choose one of the contacts on screen.";
      return { summary, data: { needsChoice: true }, island: contactChoiceIsland(choice) };
    }
    return prepareChoice(ctx, choice.id, option.id);
  }

  const api = { propose, confirm, cancel, chooseContact };
  const tools: ToolDef<any>[] = [...readTools(svc), ...proposeTools(api), ...controlTools(api), ...onrampTools(svc)];

  async function runTool(ctx: HarnessCtx, name: string, rawArgs: unknown): Promise<ToolResult> {
    const def = tools.find((t) => t.name === name);
    if (!def) return { summary: "I can't do that yet.", data: { error: "UNKNOWN_TOOL", name } };
    const parsed = def.args.safeParse(rawArgs ?? {});
    if (!parsed.success) {
      await audit(db, ctx, "tool.invalid_args", { name, issues: parsed.error.issues });
      return { summary: "I didn't quite catch that. Could you say it again?", data: { error: "INVALID_ARGS", issues: parsed.error.issues } };
    }
    const steps = tracker(ctx);
    const stepId = steps.start(def.stepLabel(parsed.data));
    try {
      const out = await def.run(ctx, parsed.data);
      steps.done(stepId);
      await audit(db, ctx, "tool.call", { name, args: parsed.data, summary: out.summary });
      return out;
    } catch (e) {
      const err = e instanceof ArcieError ? e : new ArcieError("UNKNOWN", { detail: e });
      steps.fail(stepId, err);
      await audit(db, ctx, "tool.error", { name, args: parsed.data, code: err.code });
      return { summary: err.spoken, data: { error: err.code } };
    }
  }

  return {
    tools,
    intents: repo,
    quoteSwap: (ctx, args) => readSwapQuote(svc, ctx, args),
    screenSwap: (ctx, request) => screenSwap(svc, ctx, request, executeClaimed),
    runTool,
    ...api,
    pendingChoice: async (sessionId, now) => {
      const choice = await activeContactChoice(db, sessionId, now);
      return choice ? contactChoiceIsland(choice) : null;
    },
    answerChoice,
    prepareChoice,
    dismissChoice,
    recordOnrampEvent: (ctx, e) => recordOnrampEvent(svc, ctx, e, (type, payload) => audit(db, ctx, type, payload)),
  };
}

export type HarnessApi = Pick<Harness, "propose" | "confirm" | "cancel"> & {
  chooseContact(ctx: HarnessCtx, selection: string): Promise<ToolResult>;
};
