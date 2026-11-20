import { getChain, getWallet, type AppKitPort } from "@arcie/appkit";
import { ArcieError, tokenName } from "@arcie/core";
import { audit, intents, type Db } from "@arcie/db";
import { buildReceipt, IntentRepo, type EventLog, type Intent } from "@arcie/harness";
import { eq } from "drizzle-orm";

const ORPHAN_AFTER_MS = 5 * 60_000;
const CHECK_TIMEOUT_MS = 10_000;

/** Startup recovery; terminal results remain available after the in-memory event is gone. */
export async function reconcileExecuting(deps: { db: Db; kit: AppKitPort; events: EventLog; now?: () => Date }): Promise<number> {
  const now = (deps.now ?? (() => new Date()))();
  const stuck = await deps.db.select().from(intents).where(eq(intents.status, "executing"));
  let reconciled = 0;

  async function finish(i: Intent, actual: Record<string, string | null>, error?: ArcieError) {
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
      reconciled++;
    } catch (e) {
      if (e !== lost) throw e;
    }
  }

  for (const i of stuck) {
    if (i.txHash) {
      let status: "DONE" | "PENDING" | "FAILED" = "DONE";
      let amountOut: string | undefined;
      if (i.kind === "swap") {
        const w = await getWallet(deps.db, i.userId, i.chain);
        if (!w) continue;
        const r = await deps.kit.waitForSwap(w, i.txHash, CHECK_TIMEOUT_MS).catch(() => null);
        if (!r) continue;
        status = r.status;
        amountOut = r.amountOut;
      }
      if (status === "PENDING") continue;
      const actual = i.kind === "swap"
        ? { "You got": amountOut ? `${amountOut} ${tokenName(String(i.params.tokenOut ?? ""))}` : null }
        : (i.actuals ?? {}) as Record<string, string | null>;
      await finish(i, actual, status === "FAILED" ? new ArcieError("UNKNOWN", { spoken: "That transaction failed onchain. Check your activity for details." }) : undefined);
    } else if (now.getTime() - new Date(i.createdAt).getTime() > ORPHAN_AFTER_MS) {
      await finish(i, {}, new ArcieError("UNKNOWN", { spoken: "I lost track of that request. Please check your activity before trying again." }));
    }
  }
  return reconciled;
}
