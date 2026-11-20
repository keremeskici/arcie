import type { ArcieError, IslandPayload, StepsIsland } from "@arcie/core";
import { sessionEvents, sessionState, type Db, type DbOrTx } from "@arcie/db";
import { randomUUID } from "node:crypto";
import { and, asc, eq, gt, min, sql } from "drizzle-orm";
import type { HarnessCtx } from "./context.js";
import { IntentRepo, savedCard } from "./intents/repo.js";

const PRUNE_EVERY_MS = 60_000;

/**
 * Durable per-session island log (spec "Live updates and recovery"). The harness appends inside the same
 * transaction as the state change an island describes; the SSE route tails it, so an island published by one
 * server instance reaches a stream served by another, and a reconnecting stream resumes from its last id.
 *
 * Gap-free reads: `append` allocates the seq by updating the session's `session_state` row inside the writer's
 * transaction. That row lock is held until commit, so two writers of one session commit in seq order and a
 * reader that has seen seq n+1 has necessarily seen n. Never allocate a seq outside the transaction that writes
 * the event.
 */
export class EventLog {
  /** Test seam: awaited inside the snapshot transaction, after the cursor is read. */
  onSnapshotRead: (() => Promise<void>) | undefined;
  private lastPrune = 0;

  constructor(private readonly db: Db) {}

  /**
   * Appends `island` to the session's log and returns its seq. Pass the caller's transaction to commit the event
   * atomically with a state change; a plain `Db` runs it in its own short transaction.
   */
  async append(db: DbOrTx, sessionId: string, island: IslandPayload): Promise<number> {
    const seq = await (db as Db).transaction(async (tx) => {
      const [row] = await tx
        .insert(sessionState)
        .values({ sessionId, nextEventSeq: 2 })
        .onConflictDoUpdate({ target: sessionState.sessionId, set: { nextEventSeq: sql`${sessionState.nextEventSeq} + 1` } })
        .returning({ next: sessionState.nextEventSeq });
      const allocated = Number(row!.next) - 1;
      await tx.insert(sessionEvents).values({ sessionId, seq: allocated, payload: island });
      return allocated;
    });
    this.pruneSoon();
    return seq;
  }

  /** Appends in its own transaction (for islands that have no state change to commit with). */
  publish(sessionId: string, island: IslandPayload): Promise<number> {
    return this.append(this.db, sessionId, island);
  }

  async readAfter(sessionId: string, afterSeq: number, limit = 100): Promise<{ seq: number; island: IslandPayload }[]> {
    const rows = await this.db
      .select({ seq: sessionEvents.seq, payload: sessionEvents.payload })
      .from(sessionEvents)
      .where(and(eq(sessionEvents.sessionId, sessionId), gt(sessionEvents.seq, afterSeq)))
      .orderBy(asc(sessionEvents.seq))
      .limit(limit);
    return rows.map((r) => ({ seq: Number(r.seq), island: r.payload }));
  }

  /**
   * What a fresh stream starts from: the open card (else the latest receipt) and the log cursor, read in one
   * repeatable-read transaction so an event is either reflected in the islands or after the cursor, never lost.
   */
  async snapshot(sessionId: string): Promise<{ cursor: number; islands: IslandPayload[] }> {
    return this.db.transaction(
      async (tx) => {
        const [state] = await tx.select({ next: sessionState.nextEventSeq }).from(sessionState).where(eq(sessionState.sessionId, sessionId));
        const cursor = state ? Number(state.next) - 1 : 0;
        await this.onSnapshotRead?.();
        const repo = new IntentRepo(tx);
        const open = await repo.openForSession(sessionId, new Date());
        const card = open ? savedCard(open) : undefined;
        const initial = card ?? (await repo.latestReceiptForSession(sessionId));
        return { cursor, islands: initial ? [initial] : [] };
      },
      { isolationLevel: "repeatable read" },
    );
  }

  /** True when a client holding `cursor` has missed nothing that was pruned (and the cursor is not from the future). */
  async isRetained(sessionId: string, cursor: number): Promise<boolean> {
    const [oldest] = await this.db.select({ seq: min(sessionEvents.seq) }).from(sessionEvents).where(eq(sessionEvents.sessionId, sessionId));
    const [state] = await this.db.select({ next: sessionState.nextEventSeq }).from(sessionState).where(eq(sessionState.sessionId, sessionId));
    const latest = state ? Number(state.next) - 1 : 0;
    if (cursor > latest || cursor < 0) return false;
    if (cursor === latest) return true;
    return oldest?.seq != null && cursor >= Number(oldest.seq) - 1;
  }

  /** Deletes events older than 24 hours by database time. */
  async prune(): Promise<number> {
    const rows = await this.db
      .delete(sessionEvents)
      .where(sql`${sessionEvents.createdAt} < now() - interval '24 hours'`)
      .returning({ seq: sessionEvents.seq });
    return rows.length;
  }

  private pruneSoon(): void {
    const now = Date.now();
    if (now - this.lastPrune < PRUNE_EVERY_MS) return;
    this.lastPrune = now;
    void this.prune().catch(() => undefined);
  }
}

/** Live, readable step list for one run; failed steps stay visible with their spoken error. */
export class StepTracker {
  private readonly steps: StepsIsland["steps"] = [];
  private readonly startedAt: number;
  private chain: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly events: EventLog,
    private readonly ctx: HarnessCtx,
  ) {
    this.startedAt = ctx.now().getTime();
  }

  start(label: string): string {
    const id = randomUUID();
    this.steps.push({ id, label, status: "running" });
    this.emit();
    return id;
  }

  done(id: string): void {
    this.update(id, { status: "done" });
  }

  fail(id: string, err: ArcieError): void {
    this.update(id, { status: "failed", error: err.spoken });
  }

  /** Resolves once every step update so far has been appended (they append in order, best effort). */
  async flush(): Promise<void> {
    await this.chain;
  }

  private update(id: string, patch: Partial<StepsIsland["steps"][number]>): void {
    const s = this.steps.find((x) => x.id === id);
    if (s) Object.assign(s, patch);
    this.emit();
  }

  private emit(): void {
    const island: StepsIsland = {
      kind: "steps",
      runId: this.ctx.runId,
      steps: this.steps.map((s) => ({ ...s })),
      elapsedMs: this.ctx.now().getTime() - this.startedAt,
    };
    // Progress is advisory: a failed append must never break the run, and appends stay in order.
    this.chain = this.chain.then(() => this.events.publish(this.ctx.sessionId, island)).catch(() => undefined);
  }
}
