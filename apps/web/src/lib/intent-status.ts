import type { IslandPayload } from "@arcie/core";

export interface IntentStatusView {
  status: string;
  island?: IslandPayload | null;
  checking?: boolean;
  expiresAt?: string | null;
  statusReason?: string | null;
  error?: { message?: string } | null;
}

/** One authenticated read at a time. The interval backs off to ten seconds during long settlements. */
export function watchIntent(read: (signal: AbortSignal) => Promise<IntentStatusView>, observe: (row: IntentStatusView) => void, finished?: () => void) {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout>;
  let delay = 1000;
  async function poll() {
    try {
      const row = await read(AbortSignal.any([controller.signal, AbortSignal.timeout(8000)]));
      if (controller.signal.aborted) return;
      observe(row);
      const idleExpired = row.status === "awaiting_confirmation" && !row.checking && row.expiresAt && Date.parse(row.expiresAt) <= Date.now();
      if (idleExpired || (row.status !== "executing" && row.status !== "awaiting_confirmation")) {
        finished?.();
        return;
      }
    } catch {
      // Transport failures leave the outcome unknown. Retry only the status read.
    }
    if (!controller.signal.aborted) {
      timer = setTimeout(poll, delay);
      delay = Math.min(delay * 2, 10_000);
    }
  }
  void poll();
  return () => { controller.abort(); clearTimeout(timer); };
}
