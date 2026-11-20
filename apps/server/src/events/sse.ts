import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import type { AppDeps } from "../app.js";

const PING_MS = 15_000;
const POLL_MS = 1_000;
/** Close before the 300 s function limit; the browser reconnects after `retry` and resumes from its last id. */
const SSE_MAX_MS = 240_000;
const RETRY_MS = 1_000;
const BATCH = 100;

/**
 * GET /events?sessionId=…: server-sent island stream for one session (spec §9.1), backed by the durable
 * per-session event log so it works across server instances. Every event carries `id: <seq>`; a reconnecting
 * client sends `Last-Event-ID` and resumes from it (a fresh or too-old cursor gets the current card first).
 * `authorizeSession` lets Phase 4b require a user-bound voice session; dev mode allows any id.
 */
export function eventRoutes(deps: AppDeps & { authorizeSession?: (sessionId: string) => Promise<boolean> }) {
  const app = new Hono();
  const maxMs = deps.sse?.maxMs ?? SSE_MAX_MS;
  const pollMs = deps.sse?.pollMs ?? POLL_MS;
  const pingMs = deps.sse?.pingMs ?? PING_MS;

  app.get("/events", async (c) => {
    const sessionId = c.req.query("sessionId");
    if (!sessionId) return c.json({ error: { code: "INVALID_ARGS", message: "sessionId is required." } }, 400);
    if (deps.authorizeSession && !(await deps.authorizeSession(sessionId))) {
      return c.json({ error: { code: "UNAUTHENTICATED", message: "Unknown or expired session." } }, 401);
    }
    const header = c.req.header("last-event-id");
    const requested = header !== undefined && /^\d+$/.test(header) ? Number(header) : undefined;

    return streamSSE(c, async (stream) => {
      let closed = false;
      let wake: (() => void) | null = null;
      let timer: ReturnType<typeof setTimeout> | undefined;
      // Registered before any await so a disconnect during the snapshot still releases everything.
      stream.onAbort(() => {
        closed = true;
        clearTimeout(timer);
        wake?.();
      });
      const sleep = (ms: number) =>
        new Promise<void>((resolve) => {
          wake = resolve;
          timer = setTimeout(resolve, ms);
        }).finally(() => {
          clearTimeout(timer);
          wake = null;
        });
      const authorized = async () => !deps.authorizeSession || (await deps.authorizeSession(sessionId));

      try {
        const deadline = Date.now() + maxMs;
        let cursor: number;
        let snapshotIslands: Awaited<ReturnType<typeof deps.events.snapshot>>["islands"] = [];
        if (requested !== undefined && (await deps.events.isRetained(sessionId, requested))) {
          cursor = requested;
        } else {
          // A fresh (or too old) connection starts from the current card and tails from the snapshot cursor.
          const snap = await deps.events.snapshot(sessionId);
          cursor = snap.cursor;
          snapshotIslands = snap.islands;
        }
        // An id-only frame (no data, so no event is dispatched) gives the browser a cursor even if no island is
        // ever sent, so a reconnect resumes here instead of starting a fresh snapshot.
        if (snapshotIslands.length === 0 && !closed && (await authorized())) await stream.write(`id: ${cursor}\n\n`);
        for (const island of snapshotIslands) {
          if (closed || !(await authorized())) return;
          await stream.writeSSE({ id: String(cursor), event: "island", data: JSON.stringify(island) });
        }

        let lastPing = Date.now();
        while (!closed) {
          if (!(await authorized())) break;
          const rows = await deps.events.readAfter(sessionId, cursor, BATCH);
          for (const row of rows) {
            if (closed) return;
            if (!(await authorized())) return;
            await stream.writeSSE({ id: String(row.seq), event: "island", data: JSON.stringify(row.island) });
            cursor = row.seq;
          }
          if (rows.length === BATCH) continue; // more is waiting; don't sleep
          if (closed) break;
          const now = Date.now();
          if (now >= deadline) {
            await stream.write(`retry: ${RETRY_MS}\n\n`);
            break;
          }
          if (now - lastPing >= pingMs) {
            lastPing = now;
            await stream.writeSSE({ id: String(cursor), event: "ping", data: String(now) });
          }
          await sleep(Math.min(pollMs, Math.max(0, deadline - Date.now())));
        }
      } finally {
        closed = true;
        clearTimeout(timer);
      }
    });
  });

  return app;
}
