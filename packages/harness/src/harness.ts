import type { AppKitPort } from "@arcie/appkit";
import { ArcieError, type ActionKind, type Channel, type IslandPayload, type TokenSymbol, tokenName } from "@arcie/core";
import { choices, type Db, type DbOrTx } from "@arcie/db";
import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { parseUnits } from "viem";
import { ACTIONS, swapIsland } from "./actions.js";
import { audit } from "./audit.js";
import type { HarnessCtx } from "./context.js";
import { beginProposal, cancelUnderLock, claimConfirmation, claimExecution, finishProposal, publishProposal, releaseConfirmation } from "./coordination.js";
import { buildReceipt, nextStepFor } from "./disclosure/receipt.js";
import { StepTracker, type EventLog } from "./events.js";
import { paramsHash } from "./intents/hash.js";
import { assertConfirmable } from "./intents/machine.js";
import { IntentRepo, type Intent, type IntentStatus } from "./intents/repo.js";
import type { PolicyProvider } from "./policy/provider.js";
import { checkLimits } from "./policy/check.js";
import { balancesOf, countWord, joinNames, walletFor, type Svc } from "./services.js";
import { controlTools } from "./tools/control.js";
import { onrampTools, recordOnrampEvent } from "./tools/onramp.js";
import { proposeTools } from "./tools/propose.js";
import { readTools } from "./tools/read.js";
import type { ToolDef, ToolResult } from "./tools/registry.js";

const TTL_SEC = 120;
const QUOTE_FRESH_MS = 30_000;
type Claim = { token: string; revision: number };
const STALE_CONSENT = "The details changed. Please check the new card and confirm again.";
const SCREEN_ONLY = "Tap confirm on the card to finish.";

export type ConfirmResult = { status: IntentStatus; summary: string; island?: IslandPayload };

export interface Harness {
  tools: ToolDef<any>[];
  intents: IntentRepo;
  runTool(ctx: HarnessCtx, name: string, rawArgs: unknown): Promise<ToolResult>;
  propose(ctx: HarnessCtx, kind: ActionKind, params: unknown): Promise<ToolResult>;
  confirm(ctx: HarnessCtx, intentId: string | undefined, channel: Channel): Promise<ConfirmResult>;
  cancel(ctx: HarnessCtx, intentId?: string): Promise<ToolResult>;
  answerChoice(ctx: HarnessCtx, choiceId: string, optionId: string): Promise<void>;
  recordOnrampEvent(ctx: HarnessCtx, e: { type: "submitted" | "settled" | "failed"; payload: unknown }): Promise<void>;
}

export function createHarness(deps: { db: Db; kit: AppKitPort; policy: PolicyProvider; events: EventLog; confirmChannels?: "any" | "screen" }): Harness {
  const svc: Svc = { ...deps, repo: new IntentRepo(deps.db), confirmChannels: deps.confirmChannels ?? "any" };
  const { repo, events, db } = svc;
  const trackers = new Map<string, StepTracker>();

  const assertActive = (ctx: HarnessCtx) => {
    if (ctx.signal?.aborted) throw new ArcieError("NOT_FOUND", { spoken: "That request was interrupted. Nothing new was submitted." });
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
  async function transitionWithEvent(sessionId: string, intentId: string, from: IntentStatus, to: IntentStatus, patch: Parameters<IntentRepo["transition"]>[3], island: IslandPayload): Promise<boolean> {
    const lost = new Error("transition lost");
    try {
      await db.transaction(async (tx) => {
        await events.append(tx, sessionId, island);
        if (!(await new IntentRepo(tx).transition(intentId, from, to, patch))) throw lost;
      });
      return true;
    } catch (e) {
      if (e === lost) return false;
      throw e;
    }
  }

  const dismiss = (tx: DbOrTx, ctx: HarnessCtx, intentId: string, reason: "cancelled" | "superseded" | "expired") =>
    events.append(tx, ctx.sessionId, { kind: "dismiss", intentId, reason });

  async function propose(ctx: HarnessCtx, kind: ActionKind, params: unknown): Promise<ToolResult> {
    assertActive(ctx);
    // REST and model tools share these exact schemas, including their defaults.
    const parsed = tools.find((t) => t.name === `propose_${kind}`)?.args.safeParse(params);
    if (!parsed?.success) return { summary: "I didn't quite catch that. Could you check the action details?", data: { error: "INVALID_ARGS" } };
    const generation = await beginProposal(db, ctx.sessionId);
    const replaced: ToolResult = { summary: "That preparation was cancelled or replaced.", data: { cancelled: true } };
    try {
      const w = await walletFor(svc, ctx);
      const prep = await ACTIONS[kind].prepare(svc, ctx, w, parsed.data as never);
      assertActive(ctx);
      const now = ctx.now();

      if (prep.type === "choice") {
        const id = randomUUID();
        const island: IslandPayload = { kind: "choice", choiceId: id, question: prep.question, options: prep.options };
        const written = await publishProposal(db, ctx.sessionId, generation, async (tx) => {
          await tx.insert(choices).values({ id, sessionId: ctx.sessionId, question: prep.question, options: prep.options, createdAt: now.toISOString() });
          await events.append(tx, ctx.sessionId, island);
          return true;
        });
        if (!written) return replaced;
        const names = prep.options.map((o) => o.label);
        return { summary: `I found ${countWord(names.length)} contacts: ${joinNames(names)}. Which one?`, data: { choiceId: id, options: prep.options }, island };
      }

      const base = { sessionId: ctx.sessionId, userId: ctx.userId, kind, chain: w.chain, usdValue: String(prep.usdValue), previewTurn: ctx.userTurn, now, ttlSec: TTL_SEC };
      if (prep.type === "rejected") {
        const rejected = await publishProposal(db, ctx.sessionId, generation, async (tx) => {
          const i = await new IntentRepo(tx).create({ ...base, params: prep.params, preview: {}, status: "rejected", statusReason: prep.reason });
          await audit(tx, ctx, "intent.rejected", { kind, code: prep.code, reason: prep.reason }, i.id);
          return i;
        });
        if (!rejected) return replaced;
        return { summary: prep.reason, data: { error: prep.code, intentId: rejected.id } };
      }

      // Supersede the session's older card first: the database allows only one awaiting intent per session.
      const published = await publishProposal(db, ctx.sessionId, generation, async (tx) => {
        const txRepo = new IntentRepo(tx);
        const id = randomUUID();
        const superseded = await txRepo.supersedeOpen(ctx.sessionId, id);
        const created = await txRepo.create({ ...base, id, params: { ...prep.params, requireScreen: prep.requireScreen }, preview: prep.preview, status: "awaiting_confirmation" });
        const island = prep.buildIsland(created.id, created.expiresAt!);
        await txRepo.patch(created.id, { preview: { ...prep.preview, island, estimated: prep.estimated } });
        await audit(tx, ctx, "intent.proposed", { kind, params: prep.params, usdValue: prep.usdValue }, created.id);
        // The card and any dismissals commit with the proposal, in the order a stream should show them.
        for (const old of superseded) await dismiss(tx, ctx, old, "superseded");
        await events.append(tx, ctx.sessionId, island);
        return { intent: created, island, superseded };
      });
      if (!published) return replaced;
      const { intent, island } = published;
      const summary = prep.requireScreen ? `${island.spokenPrompt} Because this is a new recipient, please tap confirm on the card.` : island.spokenPrompt;
      return { summary, data: { intentId: intent.id }, island };
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
      if (!(await repo.touchFenced(intent.id, claim, { quoteAt: now.toISOString() }))) throw new ArcieError("POLICY_DENIED", { spoken: STALE_CONSENT });
      return null;
    }
    const expiresAt = new Date(now.getTime() + TTL_SEC * 1000).toISOString();
    const island = swapIsland(intent.id, p, est, ["The price moved; here's the updated quote."], expiresAt);
    const params = { ...intent.params, minOut: est.minOut };
    const written = await repo.patchFenced(intent.id, claim, {
      params,
      paramsHash: paramsHash(params),
      preview: { estimatedOut: est.estimatedOut, minOut: est.minOut, fees: est.fees, island, estimated: { "You got": `${est.estimatedOut} ${tokenName(p.tokenOut)}` } },
      quoteAt: now.toISOString(),
      previewTurn: ctx.userTurn,
      expiresAt,
    });
    // Cancelled, superseded, expired or revised while the provider answered: this consent is stale.
    if (!written) throw new ArcieError("POLICY_DENIED", { spoken: STALE_CONSENT });
    await events.publish(ctx.sessionId, island);
    await audit(db, ctx, "intent.requoted", { estimatedOut: est.estimatedOut }, intent.id);
    return { status: "awaiting_confirmation", summary: island.spokenPrompt, island };
  }

  async function confirm(ctx: HarnessCtx, intentId: string | undefined, channel: Channel): Promise<ConfirmResult> {
    assertActive(ctx);
    const candidate = intentId ? await repo.get(intentId) : await repo.latestAwaiting(ctx.sessionId);
    if (!candidate || candidate.userId !== ctx.userId || candidate.sessionId !== ctx.sessionId) throw new ArcieError("NOT_FOUND");
    // The claim is shared through the database, so a second instance (or tab) can't act on this confirmation.
    const claim = await claimConfirmation(db, candidate.id);
    if (!claim) return { status: candidate.status, summary: "I'm already checking that confirmation." };
    try {
      return await confirmOnce(ctx, candidate.id, channel, claim);
    } finally {
      await releaseConfirmation(db, candidate.id, claim.token);
    }
  }

  async function confirmOnce(ctx: HarnessCtx, intentId: string, channel: Channel, claim: Claim): Promise<ConfirmResult> {
    const started = ctx.now();
    let intent = intentId ? await repo.get(intentId) : await repo.latestAwaiting(ctx.sessionId);
    if (intent && (intent.userId !== ctx.userId || intent.sessionId !== ctx.sessionId)) intent = null;

    try {
      assertConfirmable(intent, { channel, userTurn: ctx.userTurn, now: started });
    } catch (e) {
      if (e instanceof ArcieError && e.code === "QUOTE_EXPIRED" && intent?.status === "awaiting_confirmation") {
        await transitionWithEvent(ctx.sessionId, intent.id, "awaiting_confirmation", "expired", {}, { kind: "dismiss", intentId: intent.id, reason: "expired" });
      }
      throw e;
    }
    if (paramsHash(intent.params) !== intent.paramsHash) throw new ArcieError("UNKNOWN", { detail: { tampered: intent.id } });

    const needsScreen = svc.confirmChannels === "screen" || intent.params.requireScreen === true;
    if (needsScreen && channel !== "screen") return { status: "awaiting_confirmation", summary: SCREEN_ONLY };

    const requoted = await refreshIfStale(ctx, intent, claim);
    if (requoted) return requoted;

    // The budget lock, fresh limits, usage and execution claim share one transaction. Executing
    // intents reserve their budget even when settlement is still unknown.
    assertActive(ctx);
    const claimed = await db.transaction((tx) => claimExecution(tx, {
      intentId: intent.id, userId: ctx.userId, token: claim.token, revision: claim.revision,
      paramsHash: intent.paramsHash, channel, userTurn: ctx.userTurn, now: ctx.now(), policy: svc.policy,
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
    }));
    if (!claimed) {
      return { status: "executing", summary: "Already on it." };
    }
    await audit(db, ctx, "intent.confirmed", { channel }, intent.id);

    const w = await walletFor(svc, ctx, intent.chain);
    const estimated = (intent.preview?.estimated ?? {}) as Record<string, string | null>;
    const elapsed = () => ctx.now().getTime() - started.getTime();
    let confirmedFailure = false;
    try {
      const ex = await ACTIONS[intent.kind].execute(svc, w, intent.params);
      // Persist before any settlement wait: a timeout/restart must not lose the submission.
      await repo.patch(intent.id, { txHash: ex.tx.txHash, actuals: ex.actual });
      if (intent.kind === "swap" && ex.tx.status === "PENDING") {
        const settled = await svc.kit.waitForSwap(w, ex.tx.txHash, 20_000).catch(() => null);
        if (settled) {
          ex.tx = settled;
          const out = settled.amountOut ? `${settled.amountOut} ${tokenName(String(intent.params.tokenOut))}` : null;
          ex.actual = { "You got": out };
          ex.summary = out ? `Done. You got ${out}.` : "Your swap completed. Check the receipt for details.";
        }
      }
      if (ex.tx.status === "FAILED") {
        confirmedFailure = true;
        throw new ArcieError("UNKNOWN", { spoken: "That transaction failed onchain. Check your activity for details.", detail: ex.tx });
      }
      const done = ex.tx.status === "DONE";
      const balances = await balancesOf(svc, w).catch(() => null);
      const nextStep = nextStepFor(intent.kind, intent.params as { tokenOut?: string });
      const receipt = buildReceipt({
        intentId: intent.id,
        status: "succeeded",
        estimated,
        actual: ex.actual,
        txHash: ex.tx.txHash,
        explorerUrl: ex.tx.explorerUrl,
        ...(balances ? { newBalance: `${balances[ex.balanceToken]} ${tokenName(ex.balanceToken)}` } : {}),
        elapsedMs: elapsed(),
        ...(nextStep ? { nextStep } : {}),
      });
      const settledPatch = { txHash: ex.tx.txHash, actuals: ex.actual, ...(done ? { preview: { ...intent.preview, receipt } } : {}) };
      if (done) await transitionWithEvent(ctx.sessionId, intent.id, "executing", "succeeded", settledPatch, receipt);
      else await repo.transition(intent.id, "executing", "executing", settledPatch);
      await audit(db, ctx, done ? "intent.succeeded" : "intent.pending", { txHash: ex.tx.txHash, actual: ex.actual }, intent.id);
      return done
        ? { status: "succeeded", summary: ex.summary, island: receipt }
        : { status: "executing", summary: "It's processing; I'll show the receipt when it lands." };
    } catch (e) {
      const err = e instanceof ArcieError ? e : new ArcieError("UNKNOWN", { detail: e });
      if (!confirmedFailure && ["UNKNOWN", "RPC_UNAVAILABLE", "CIRCLE_API_ERROR"].includes(err.code)) {
        const summary = "I couldn't verify that transaction. Please check your activity before trying again.";
        await repo.patch(intent.id, { statusReason: "submission_unknown", error: { code: err.code, message: summary } });
        await audit(db, ctx, "intent.uncertain", { code: err.code, summary }, intent.id);
        return { status: "executing", summary };
      }
      const receipt = buildReceipt({ intentId: intent.id, status: "failed", estimated, actual: {}, elapsedMs: elapsed(), error: err });
      await transitionWithEvent(ctx.sessionId, intent.id, "executing", "failed", { error: { code: err.code, message: err.spoken }, preview: { ...intent.preview, receipt } }, receipt);
      await audit(db, ctx, "intent.failed", { code: err.code, detail: String((err.detail as Error)?.message ?? "") }, intent.id);
      return { status: "failed", summary: err.spoken, island: receipt };
    }
  }

  async function cancel(ctx: HarnessCtx, intentId?: string): Promise<ToolResult> {
    if (intentId) {
      const named = await repo.get(intentId);
      if (!named || named.userId !== ctx.userId || named.sessionId !== ctx.sessionId) throw new ArcieError("NOT_FOUND");
    }
    // Bump the generation and cancel the card under one session lock, so a concurrent publish can't slip a card in between.
    const { stopped, cancelledId } = await cancelUnderLock(db, ctx.sessionId, async (tx, preparing) => {
      const txRepo = new IntentRepo(tx);
      const intent = intentId ? await txRepo.get(intentId) : await txRepo.latestAwaiting(ctx.sessionId);
      if (intent && intent.userId === ctx.userId && intent.status === "awaiting_confirmation"
        && await txRepo.transition(intent.id, "awaiting_confirmation", "cancelled", { statusReason: "user" })) {
        await audit(tx, ctx, "intent.cancelled", {}, intent.id);
        await dismiss(tx, ctx, intent.id, "cancelled");
        return { stopped: preparing, cancelledId: intent.id };
      }
      return { stopped: preparing, cancelledId: null };
    });
    if (!cancelledId) {
      return { summary: stopped ? "Okay, I stopped preparing that. Nothing was moved." : "There's nothing to cancel.", data: { cancelled: stopped } };
    }
    return { summary: "Okay, I cancelled that. Nothing was moved.", data: { cancelled: true, intentId: cancelledId } };
  }

  async function answerChoice(ctx: HarnessCtx, choiceId: string, optionId: string): Promise<void> {
    const c = (await db.select().from(choices).where(eq(choices.id, choiceId)).limit(1))[0];
    if (!c || c.sessionId !== ctx.sessionId || !c.options.some((o) => o.id === optionId)) {
      throw new ArcieError("NOT_FOUND", { spoken: "I couldn't find that option." });
    }
    await db.update(choices).set({ selectedOptionId: optionId }).where(eq(choices.id, choiceId));
    await audit(db, ctx, "choice.answered", { choiceId, optionId });
  }

  const api = { propose, confirm, cancel };
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
      await audit(db, ctx, "tool.error", { name, args: parsed.data, code: err.code, detail: String((err.detail as Error)?.message ?? "") });
      return { summary: err.spoken, data: { error: err.code } };
    }
  }

  return {
    tools,
    intents: repo,
    runTool,
    ...api,
    answerChoice,
    recordOnrampEvent: (ctx, e) => recordOnrampEvent(svc, ctx, e, (type, payload) => audit(db, ctx, type, payload)),
  };
}

export type HarnessApi = Pick<Harness, "propose" | "confirm" | "cancel">;
