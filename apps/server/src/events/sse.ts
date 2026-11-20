import { savedReview } from "@arcie/harness";
import type { IslandPayload } from "@arcie/core";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import type { AppDeps } from "../app.js";

const PING_MS = 15_000;

/**
 * GET /events?sessionId=…: server-sent island stream for one session (spec §9.1).
 * `authorizeSession` lets Phase 4b require a user-bound voice session; dev mode allows any id.
 */
export function eventRoutes(deps: AppDeps & { authorizeSession?: (sessionId: string) => Promise<boolean> }) {
  const app = new Hono();

  app.get("/events", async (c) => {
    const sessionId = c.req.query("sessionId");
    if (!sessionId) return c.json({ error: { code: "INVALID_ARGS", message: "sessionId is required." } }, 400);
    if (deps.authorizeSession && !(await deps.authorizeSession(sessionId))) {
      return c.json({ error: { code: "UNAUTHENTICATED", message: "Unknown or expired session." } }, 401);
    }

    return streamSSE(c, async (stream) => {
      const queue: IslandPayload[] = [];
      let wake: (() => void) | null = null;
      const push = (i: IslandPayload) => {
        queue.push(i);
        wake?.();
      };

      // A client that connects late still sees the card that's waiting for it.
      const now = new Date();
      const choice = deps.harness.pendingChoice(sessionId, now);
      const open = deps.harness.intents.openForSession(sessionId, now);
      const openIsland = open && savedReview(open);
      if (choice) queue.push(choice);
      else if (openIsland) queue.push(openIsland);
      else {
        const receipt = deps.harness.intents.latestReceiptForSession(sessionId);
        if (receipt) queue.push(receipt);
      }

      const off = deps.bus.subscribe(sessionId, push);
      let closed = false;
      let pingDue = false;
      const ping = setInterval(() => {
        pingDue = true;
        wake?.();
      }, PING_MS);
      stream.onAbort(() => {
        closed = true;
        clearInterval(ping);
        off();
        wake?.();
      });

      const authorized = async () => !deps.authorizeSession || await deps.authorizeSession(sessionId);
      try {
        while (!closed) {
          if (!(await authorized())) break;
          while (queue.length && !closed) {
            if (!(await authorized())) return;
            await stream.writeSSE({ event: "island", data: JSON.stringify(queue.shift()) });
          }
          if (pingDue) {
            pingDue = false;
            await stream.writeSSE({ event: "ping", data: String(Date.now()) });
          }
          if (!queue.length && !closed) await new Promise<void>((r) => (wake = r));
          wake = null;
        }
      } finally {
        closed = true;
        clearInterval(ping);
        off();
      }
    });
  });

  return app;
}
