import { ArcieError, type IslandPayload, type StepsIsland } from "@arcie/core";
import { audit as auditTable, seed, sessionEvents, type Db } from "@arcie/db";
import { eq, sql } from "drizzle-orm";
import { createTestDb } from "@arcie/db/testing";
import { describe, expect, it } from "vitest";
import { audit } from "./audit.js";
import type { HarnessCtx } from "./context.js";
import { EventLog, StepTracker } from "./events.js";

const ctx: HarnessCtx = { userId: "demo", sessionId: "s1", channel: "voice", userTurn: 1, now: () => new Date(), runId: "run-1" };
const receive: IslandPayload = { kind: "receive", address: "0x1", chain: "Arc_Testnet", tokens: ["USDC"] };

const eventsOf = async (db: Db) => new EventLog(db);

describe("EventLog", () => {
  it("allocates consecutive seqs per session and reads them back in order", async () => {
    const { db } = await createTestDb();
    const log = await eventsOf(db);
    expect(await log.append(db, "s1", receive)).toBe(1);
    expect(await log.append(db, "s2", receive)).toBe(1);
    expect(await log.append(db, "s1", { ...receive, address: "0x2" })).toBe(2);
    const rows = await log.readAfter("s1", 0);
    expect(rows.map((r) => r.seq)).toEqual([1, 2]);
    expect(rows[1]!.island).toMatchObject({ address: "0x2" });
    expect((await log.readAfter("s1", 1)).map((r) => r.seq)).toEqual([2]);
    expect(await log.readAfter("s1", 2)).toEqual([]);
  });

  it("rolls the seq back with the caller's transaction", async () => {
    const { db } = await createTestDb();
    const log = await eventsOf(db);
    await db.transaction(async (tx) => {
      await log.append(tx, "s1", receive);
      tx.rollback();
    }).catch(() => undefined);
    expect(await log.append(db, "s1", receive)).toBe(1);
  });

  it("never skips an event that commits late (out-of-order commit)", async () => {
    const { db } = await createTestDb();
    const log = await eventsOf(db);
    let commit1!: () => void;
    const hold = new Promise<void>((r) => (commit1 = r));
    let t1Seq = 0;
    let t1Appended!: () => void;
    const appended = new Promise<void>((r) => (t1Appended = r));
    const t1 = db.transaction(async (tx) => {
      t1Seq = await log.append(tx, "s1", { ...receive, address: "first" });
      t1Appended();
      await hold;
    });
    await appended;
    // T2 allocates after T1 and commits as soon as it can; the session_state row lock makes it wait for T1.
    const t2 = log.append(db, "s1", { ...receive, address: "second" });
    let cursor = 0;
    const seen: string[] = [];
    const poll = async () => {
      for (const r of await log.readAfter("s1", cursor)) {
        cursor = r.seq;
        seen.push((r.island as { address: string }).address);
      }
    };
    await poll();
    await new Promise((r) => setTimeout(r, 100));
    await poll();
    expect(seen).toEqual([]); // n is uncommitted and n+1 is not visible, so the reader has not advanced
    commit1();
    await t1;
    expect(await t2).toBe(t1Seq + 1);
    await poll();
    expect(seen).toEqual(["first", "second"]);
  });

  it("prunes events older than 24 hours using database time", async () => {
    const { db } = await createTestDb();
    const log = await eventsOf(db);
    await log.append(db, "s1", receive);
    await log.append(db, "s1", receive);
    await db.update(sessionEvents).set({ createdAt: sql`now() - interval '25 hours'` }).where(eq(sessionEvents.seq, 1));
    expect(await log.prune()).toBe(1);
    expect((await log.readAfter("s1", 0)).map((r) => r.seq)).toEqual([2]);
  });

  it("snapshots the current cursor (islands come from intents; covered by the SSE tests)", async () => {
    const { db } = await createTestDb();
    await seed(db, { userId: "demo" });
    const log = await eventsOf(db);
    expect(await log.snapshot("s1")).toEqual({ cursor: 0, islands: [] });
    await log.append(db, "s1", receive);
    await log.append(db, "s1", receive);
    expect(await log.snapshot("s1")).toEqual({ cursor: 2, islands: [] });
  });

  it("knows whether a cursor is still retained", async () => {
    const { db } = await createTestDb();
    const log = await eventsOf(db);
    for (let i = 0; i < 3; i++) await log.append(db, "s1", receive);
    expect(await log.isRetained("s1", 0)).toBe(true);
    expect(await log.isRetained("s1", 3)).toBe(true);
    expect(await log.isRetained("s1", 4)).toBe(false); // from the future
    await db.delete(sessionEvents).where(eq(sessionEvents.seq, 1));
    expect(await log.isRetained("s1", 0)).toBe(false); // seq 1 was pruned
    expect(await log.isRetained("s1", 1)).toBe(true);
    await db.delete(sessionEvents);
    expect(await log.isRetained("s1", 1)).toBe(false);
    expect(await log.isRetained("s1", 3)).toBe(true);
  });
});

describe("StepTracker", () => {
  it("appends the full steps island on every change, keeping failures visible", async () => {
    const { db } = await createTestDb();
    const log = await eventsOf(db);
    const t = new StepTracker(log, ctx);

    const a = t.start("Checking your balance");
    t.done(a);
    t.start("Getting a swap quote");
    const c = t.start("Swapping");
    t.fail(c, new ArcieError("SLIPPAGE_EXCEEDED"));
    await t.flush();

    const seen = (await log.readAfter("s1", 0)).map((r) => r.island).filter((i): i is StepsIsland => i.kind === "steps");
    const last = seen.at(-1)!;
    expect(last.runId).toBe("run-1");
    expect(last.steps.map((s) => s.status)).toEqual(["done", "running", "failed"]);
    expect(last.steps[2]!.error).toBe(new ArcieError("SLIPPAGE_EXCEEDED").spoken);
    expect(last.elapsedMs).toBeGreaterThanOrEqual(0);
    expect(seen).toHaveLength(5);
  });
});

describe("audit", () => {
  it("writes a row with user, session, intent and payload", async () => {
    const { db } = await createTestDb();
    await seed(db, { userId: "demo" });
    await audit(db, ctx, "tool.call", { name: "get_balances" }, "intent-1");
    expect(await db.select().from(auditTable)).toMatchObject([
      { userId: "demo", sessionId: "s1", intentId: "intent-1", type: "tool.call", payload: { name: "get_balances" } },
    ]);
  });
});
