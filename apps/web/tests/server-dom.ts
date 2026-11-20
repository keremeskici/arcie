// Install the DOM before importing React while the in-process server uses Node.
import type { EventLog } from "@arcie/harness";
import { afterAll } from "vitest";
import { builtinEnvironments } from "vitest/runtime";

const dom = await builtinEnvironments["happy-dom"].setup(globalThis, {});
afterAll(async () => { await dom.teardown(globalThis); });

/** EventSource shim that tails committed session events from the in-process server. */
export function islandStream(events: EventLog, onSession?: (id: string) => void) {
  return class extends EventTarget {
    private closed = false;
    private timer: ReturnType<typeof setTimeout> | undefined;

    constructor(path: string) {
      super();
      const sessionId = new URL(path, "http://localhost").searchParams.get("sessionId")!;
      onSession?.(sessionId);
      let cursor = 0;
      const poll = async () => {
        const rows = await events.readAfter(sessionId, cursor);
        if (this.closed) return;
        for (const { seq, island } of rows) {
          cursor = seq;
          this.dispatchEvent(new MessageEvent("island", { data: JSON.stringify(island) }));
        }
        if (!this.closed) this.timer = setTimeout(() => void poll(), 10);
      };
      void poll();
    }

    close() {
      this.closed = true;
      clearTimeout(this.timer);
    }
  };
}

/** Wait for the server and queued DOM updates independently of the browser's fake timers. */
export function trackBrowserRequests(fetcher: (path: string, init: RequestInit) => Promise<Response>) {
  const requests = new Set<Promise<Response>>();
  return {
    fetch(path: string, init: RequestInit) {
      const response = fetcher(path, init);
      requests.add(response);
      const finished = () => requests.delete(response);
      void response.then(finished, finished);
      return response;
    },
    async drain() {
      do {
        await Promise.allSettled(requests);
        await new Promise<void>(resolve => setImmediate(resolve));
      } while (requests.size);
    },
  };
}
