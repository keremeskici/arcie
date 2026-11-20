import { getChain, getWallet, type AppKitPort } from "@arcie/appkit";
import { ArcieError, tokenName } from "@arcie/core";
import { audit, intents, type Db } from "@arcie/db";
import { buildReceipt, IntentRepo, type EventLog, type Intent } from "@arcie/harness";
import { and, asc, eq, isNull, lt, or, sql } from "drizzle-orm";

const ORPHAN_AFTER_MS = 5 * 60_000;
const CHECK_TIMEOUT_MS = 10_000;
/** An intent checked within this window (database time) is not checked again, by any instance. */
const CHECK_WINDOW = sql`interval '10 seconds'`;
const DEFAULT_BUDGET_MS = 3_000;

export interface ReconcileDeps {
  db: Db;
  kit: AppKitPort;
  events: EventLog;
  now?: () => Date;
}

/**
 * Settlement recovery for one executing intent, run when a client reads it (serverless has no reliable startup).
 * Observes only: it never resubmits a money action. Returns true when this call moved the intent to a terminal state.
 *
 * The claim is a compare-and-set on database time that commits on its own before any network call, so concurrent
 * readers (and other instances) skip an intent that was just checked. No transaction spans a kit call.
 */
export async function reconcileIntent(deps: ReconcileDeps, intentId: string, timeoutMs = CHECK_TIMEOUT_MS): Promise<boolean> {
  const claimed = await deps.db
    .update(intents)
    .set({ reconcileCheckedAt: sql`now()` })
    .where(and(
      eq(intents.id, intentId),
      eq(intents.status, "executing"),
      or(isNull(intents.reconcileCheckedAt), lt(intents.reconcileCheckedAt, sql`now() - ${CHECK_WINDOW}`)),
    ))
    .returning({ id: intents.id });
  if (claimed.length === 0) return false;

  const i = await new IntentRepo(deps.db).get(intentId);
  if (!i || i.status !== "executing") return false;
  return check(deps, i, timeoutMs);
}

/**
 * Reconciles the user's executing intents, oldest first, within a total time budget: no new check starts once it
 * is spent and each check's wait is capped by what remains. A failing check never blocks the read that asked for it.
 */
export async function reconcileUser(deps: ReconcileDeps, userId: string, budgetMs = DEFAULT_BUDGET_MS): Promise<number> {
  const deadline = Date.now() + budgetMs;
  const stuck = await deps.db
    .select({ id: intents.id })
    .from(intents)
    .where(and(eq(intents.userId, userId), eq(intents.status, "executing")))
    .orderBy(asc(intents.createdAt));
  let reconciled = 0;
  for (const { id } of stuck) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    try {
      if (await reconcileIntent(deps, id, Math.min(CHECK_TIMEOUT_MS, remaining))) reconciled++;
    } catch (e) {
      console.error(`Reconciling intent ${id} failed:`, e);
    }
  }
  return reconciled;
}

async function check(deps: ReconcileDeps, i: Intent, timeoutMs: number): Promise<boolean> {
  const now = (deps.now ?? (() => new Date()))();

  async function finish(actual: Record<string, string | null>, error?: ArcieError): Promise<boolean> {
    const status = error ? "failed" : "succeeded";
    const receipt = buildReceipt({
      intentId: i.id, status,
      estimated: (i.preview?.estimated ?? {}) as Record<string, string | null>, actual,
      elapsedMs: now.getTime() - new Date(i.createdAt).getTime(),
      ...(i.txHash ? { txHash: i.txHash, explorerUrl: getChain(i.chain).explorerTx(i.txHash) } : {}),
      ...(error ? { error } : {}),
    });
    // The receipt event commits with the transition. It is appended first so the session_state lock comes before
    // the intent row lock (the order proposals and cancels use); losing the compare-and-set rolls it back.
    const lost = new Error("transition lost");
    try {
      await deps.db.transaction(async (tx) => {
        await deps.events.append(tx, i.sessionId, receipt);
        const won = await new IntentRepo(tx).transition(i.id, "executing", status, {
          actuals: actual, preview: { ...i.preview, receipt },
          // Missing hashes cannot establish whether funds moved; keep their reservation.
          statusReason: !i.txHash ? "submission_unknown" : null,
          error: error ? { code: error.code, message: error.spoken } : null,
        });
        if (!won) throw lost;
        await tx.insert(audit).values({
          userId: i.userId, sessionId: i.sessionId, intentId: i.id,
          type: `intent.${status}`, payload: { recovered: true, txHash: i.txHash, summary: error?.spoken ?? "Transaction completed." },
          createdAt: now.toISOString(),
        });
      });
      return true;
    } catch (e) {
      if (e !== lost) throw e;
      return false;
    }
  }

  if (i.txHash) {
    let status: "DONE" | "PENDING" | "FAILED" = "DONE";
    let amountOut: string | undefined;
    if (i.kind === "swap") {
      const w = await getWallet(deps.db, i.userId, i.chain);
      if (!w) return false;
      const r = await deps.kit.waitForSwap(w, i.txHash, timeoutMs).catch(() => null);
      if (!r) return false;
      status = r.status;
      amountOut = r.amountOut;
    }
    if (status === "PENDING") return false;
    const actual = i.kind === "swap"
      ? { "You got": amountOut ? `${amountOut} ${tokenName(String(i.params.tokenOut ?? ""))}` : null }
      : (i.actuals ?? {}) as Record<string, string | null>;
    return finish(actual, status === "FAILED" ? new ArcieError("UNKNOWN", { spoken: "That transaction failed onchain. Check your activity for details." }) : undefined);
  }
  if (now.getTime() - new Date(i.createdAt).getTime() > ORPHAN_AFTER_MS) {
    return finish({}, new ArcieError("UNKNOWN", { spoken: "I lost track of that request. Please check your activity before trying again." }));
  }
  return false;
}
