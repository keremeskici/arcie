import { sessionState, type Db, type Tx } from "@arcie/db";
import { and, eq, sql } from "drizzle-orm";

/**
 * Cross-instance proposal coordination. A proposal's slow preparation (Circle/estimate calls) runs outside
 * any transaction; only publishing takes a row lock on `session_state`, so a cancel or a newer proposal on
 * any server instance makes a stale preparation write nothing.
 */

/** Starts a proposal: bumps the session's generation, marks it as preparing, and returns the new generation. */
export async function beginProposal(db: Db, sessionId: string): Promise<number> {
  const [row] = await db
    .insert(sessionState)
    .values({ sessionId, proposalGeneration: 1, preparingGeneration: 1 })
    .onConflictDoUpdate({
      target: sessionState.sessionId,
      set: {
        proposalGeneration: sql`${sessionState.proposalGeneration} + 1`,
        preparingGeneration: sql`${sessionState.proposalGeneration} + 1`,
      },
    })
    .returning({ generation: sessionState.proposalGeneration });
  return row!.generation;
}

/** Invalidates any preparation in flight (cancel). Returns true when one was in flight. */
export async function bumpGeneration(db: Db, sessionId: string): Promise<boolean> {
  return db.transaction(async (tx) => {
    await tx.insert(sessionState).values({ sessionId }).onConflictDoNothing();
    const [row] = await tx.select().from(sessionState).where(eq(sessionState.sessionId, sessionId)).for("update");
    await tx
      .update(sessionState)
      .set({ proposalGeneration: row!.proposalGeneration + 1, preparingGeneration: null })
      .where(eq(sessionState.sessionId, sessionId));
    return row!.preparingGeneration !== null;
  });
}

/**
 * Runs `fn` only if `generation` is still the session's current one, holding the session_state row lock so a
 * concurrent cancel or newer proposal waits. Returns `null` (and runs nothing) when the proposal was replaced.
 * Do not call the network inside `fn`.
 */
export async function publishProposal<T>(db: Db, sessionId: string, generation: number, fn: (tx: Tx) => Promise<T>): Promise<T | null> {
  return db.transaction(async (tx) => {
    const [row] = await tx.select().from(sessionState).where(eq(sessionState.sessionId, sessionId)).for("update");
    if (!row || row.proposalGeneration !== generation) return null;
    const out = await fn(tx);
    await tx.update(sessionState).set({ preparingGeneration: null }).where(eq(sessionState.sessionId, sessionId));
    return out;
  });
}

/** Clears the preparing marker if this proposal still owns it (a no-op once cancelled or replaced). */
export async function finishProposal(db: Db, sessionId: string, generation: number): Promise<void> {
  await db
    .update(sessionState)
    .set({ preparingGeneration: null })
    .where(and(eq(sessionState.sessionId, sessionId), eq(sessionState.preparingGeneration, generation)));
}
