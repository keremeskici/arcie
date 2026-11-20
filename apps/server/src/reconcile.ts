import { getChain, getWallet, type AppKitPort } from "@arcie/appkit";
import { ArcieError, tokenName } from "@arcie/core";
import { audit, intents, type Db } from "@arcie/db";
import { buildReceipt, IntentRepo, type EventBus, type Intent } from "@arcie/harness";
import { and, eq } from "drizzle-orm";

const ORPHAN_AFTER_MS = 5 * 60_000;
const CHECK_TIMEOUT_MS = 10_000;
const INTERACTIVE_TIMEOUT_MS = 1_000;
const pendingChecks = new WeakMap<Db, Map<string, Promise<number>>>();
type ReconcileDeps = { db: Db; kit: AppKitPort; bus: EventBus; now?: () => Date };

/** The voice status tool and UI reuse an in-flight check of a submitted swap. */
export async function refreshIntentStatus(deps: ReconcileDeps, intent: Intent): Promise<Intent> {
  if (intent.kind !== "swap" || intent.status !== "executing" || !intent.txHash) return intent;
  const { db } = deps;
  const repo = new IntentRepo(db);
  const current = repo.get(intent.id) ?? intent;
  // The submitting request owns settlement until its initial wait finishes and records intent.pending.
  if (current.status !== "executing" || !db.select({ id: audit.id }).from(audit)
    .where(and(eq(audit.intentId, current.id), eq(audit.type, "intent.pending"))).get()) return current;
  const checks = pendingChecks.get(db) ?? new Map<string, Promise<number>>();
  pendingChecks.set(db, checks);
  const check = checks.get(current.id) ?? reconcileExecuting(deps, current, INTERACTIVE_TIMEOUT_MS).finally(() => checks.delete(current.id));
  checks.set(current.id, check);
  await check;
  return repo.get(current.id) ?? current;
}

/** Recover interrupted requests at startup or check one already-submitted swap while the UI is open. */
export async function reconcileExecuting(deps: ReconcileDeps, pendingSwap?: Intent, timeoutMs = CHECK_TIMEOUT_MS): Promise<number> {
  const now = (deps.now ?? (() => new Date()))();
  const repo = new IntentRepo(deps.db);
  const stuck = pendingSwap ? [pendingSwap] : deps.db.select().from(intents).where(eq(intents.status, "executing")).all();
  let reconciled = 0;

  function finish(i: Intent, actual: Record<string, string | null>, error?: ArcieError) {
    const status = error ? "failed" : "succeeded";
    const receipt = buildReceipt({
      intentId: i.id, status,
      estimated: (i.preview?.estimated ?? {}) as Record<string, string | null>, actual,
      elapsedMs: now.getTime() - new Date(i.createdAt).getTime(),
      ...(i.txHash ? { txHash: i.txHash, explorerUrl: getChain(i.chain).explorerTx(i.txHash) } : {}),
      ...(error ? { error } : {}),
    });
    const changed = deps.db.transaction(() => {
      const won = repo.transition(i.id, "executing", status, {
        actuals: actual, preview: { ...i.preview, receipt },
        // Missing hashes cannot establish whether funds moved; keep their reservation.
        statusReason: !i.txHash ? "submission_unknown" : null,
        error: error ? { code: error.code, message: error.spoken } : null,
      });
      if (won) deps.db.insert(audit).values({
        userId: i.userId, sessionId: i.sessionId, intentId: i.id,
        type: `intent.${status}`, payload: { recovered: true, txHash: i.txHash, summary: error?.spoken ?? "Transaction completed." },
        createdAt: now.toISOString(),
      }).run();
      return won;
    });
    if (changed) {
      deps.bus.publish(i.sessionId, receipt);
      reconciled++;
    }
  }

  for (const i of stuck) {
    if (i.txHash) {
      let status: "DONE" | "PENDING" | "FAILED" = "DONE";
      let amountOut: string | undefined;
      if (i.kind === "swap") {
        const w = await getWallet(deps.db, i.userId, i.chain);
        if (!w) continue;
        const r = await deps.kit.waitForSwap(w, i.txHash, timeoutMs).catch(() => null);
        if (!r) continue;
        status = r.status;
        amountOut = r.amountOut;
      }
      if (status === "PENDING") continue;
      const actual = i.kind === "swap"
        ? { "You got": amountOut ? `${amountOut} ${tokenName(String(i.params.tokenOut ?? ""))}` : null }
        : (i.actuals ?? {}) as Record<string, string | null>;
      finish(i, actual, status === "FAILED" ? new ArcieError("UNKNOWN", { spoken: "That transaction failed onchain. Check your activity for details." }) : undefined);
    } else if (now.getTime() - new Date(i.createdAt).getTime() > ORPHAN_AFTER_MS) {
      finish(i, {}, new ArcieError("UNKNOWN", { spoken: "I lost track of that request. Please check your activity before trying again." }));
    }
  }
  return reconciled;
}
