/// <reference lib="dom" />
import type { OnrampIsland } from "@arcie/core";
import type { OnrampIframeOptions } from "@circle-fin/onramp-kit";
import { parseOnrampSession } from "@circle-fin/onramp-kit";

type Params = { token?: string; amount?: string };
type EventType = "submitted" | "settled" | "failed";
type Kit = { mountIframe(options: OnrampIframeOptions): { close(): void } };
type View = {
  container: HTMLElement;
  show(): void;
  hide(): void;
  status(message: string): void;
  retry(visible: boolean): void;
  details(island: OnrampIsland): void;
};
type Dependencies = {
  view: View;
  mint(params: Params & { requestId: string }): Promise<OnrampIsland>;
  record(type: EventType, payload: Record<string, unknown>): Promise<void>;
  refresh(): Promise<void>;
  loadKit?(environment: OnrampIsland["environment"]): Promise<Kit>;
};

/** One controller for REST and voice/SSE. A checkout never executes through the voice agent. */
export function createOnrampController(deps: Dependencies) {
  const { view } = deps;
  let widget: { close(): void } | undefined;
  let generation = 0;
  let request = 0;
  let pendingRequest: number | undefined;
  let dismissedRequest: number | undefined;
  let latestRequestId: string | undefined;
  let lastParams: Params = {};
  const seen = new Set<string>();
  const loadKit = deps.loadKit ?? (async (environment) => {
    const { createOnrampKit } = await import("@circle-fin/onramp-kit");
    return createOnrampKit({ widgetBaseUrl: environment === "sandbox" ? "https://onramp-sandbox.arc.io" : "https://onramp.arc.io" });
  });

  function dispose() {
    widget?.close();
    widget = undefined;
  }

  function fail(message: string) {
    view.status(message);
    view.retry(true);
  }

  function refresh() {
    // A temporary balance outage must not turn a successful checkout submission into a failure.
    void deps.refresh().catch(() => {});
  }

  async function open(island: OnrampIsland) {
    if (seen.has(island.sessionToken)) return;
    seen.add(island.sessionToken);
    if (island.requestId && island.requestId !== latestRequestId) return;
    if (pendingRequest !== undefined && dismissedRequest === pendingRequest) return;
    const current = ++generation;
    dispose();
    lastParams = { token: island.token, ...(island.amount ? { amount: island.amount } : {}) };
    view.show();
    view.details(island);
    view.retry(false);
    view.status("Opening secure checkout…");
    const expiresAt = Date.parse(island.expiresAt);
    if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
      fail("This checkout session expired. Please restart checkout.");
      return;
    }
    const sent = new Set<string>();
    function record(type: EventType, envelope: { code?: string; payload?: unknown }) {
      const p = envelope.payload && typeof envelope.payload === "object" ? envelope.payload as Record<string, unknown> : {};
      const key = `${type}:${envelope.code ?? ""}:${p.transactionHash ?? ""}`;
      if (sent.has(key)) return;
      sent.add(key);
      // Only lifecycle details belong in Arcie. Identity and payment information stay in Circle.
      const payload = {
        ...(island.sessionId ? { sessionId: island.sessionId } : {}),
        environment: island.environment,
        ...(envelope.code ? { code: envelope.code } : {}),
        ...(typeof p.settlementExpected === "boolean" ? { settlementExpected: p.settlementExpected } : {}),
        ...(typeof p.transactionHash === "string" ? { transactionHash: p.transactionHash } : {}),
      };
      void deps.record(type, payload).catch(() => {
        if (current === generation) view.status("Checkout updated, but the activity log could not refresh. Check your wallet balance before trying another payment.");
      });
    }
    try {
      const kit = await loadKit(island.environment);
      if (current !== generation) return;
      widget = kit.mountIframe({
        // The SDK parser supports actual provider responses that omit sessionId.
        // Do not synthesize provider IDs or relax the SDK's message origin checks.
        session: parseOnrampSession(island),
        container: view.container,
        loadTimeout: 20_000,
        onInitializationSuccess: () => {
          if (current !== generation) return;
          view.retry(false);
          view.status("Complete your deposit in the secure checkout below.");
        },
        onInitializationError: () => {
          if (current === generation) fail("Checkout could not load. Please restart checkout.");
        },
        onSessionExpired: () => {
          if (current === generation) fail("This checkout session expired. Please restart checkout.");
        },
        onDepositSubmitted: (event) => {
          if (current !== generation) return;
          view.retry(false);
          view.status(island.environment === "sandbox"
            ? "Sandbox submission complete. No real money was charged. Check the selected network for any test funds."
            : "Payment request submitted. Check your wallet balance for received funds.");
          record("submitted", event);
          refresh();
        },
        onDepositSettled: (event) => {
          if (current !== generation) return;
          view.retry(false);
          view.status("Checkout reported a payment update. Check your wallet balance for received funds.");
          record("settled", event);
          refresh();
        },
        onDepositNotCompleted: (event) => {
          if (current !== generation) return;
          const message = event.code === "CANCELED_BY_CUSTOMER"
            ? "Checkout was cancelled. You can restart when you're ready."
            : event.code === "SESSION_TIMEOUT"
              ? "This checkout session expired. Please restart checkout."
              : "The deposit did not complete. Follow the checkout instructions or restart checkout.";
          fail(message);
          record("failed", event);
        },
      });
      // The SDK owns origin/source validation for iframe messages.
      view.container.querySelector?.("iframe")?.setAttribute("title", "Circle secure deposit checkout");
    } catch {
      if (current === generation) fail("Checkout could not open. Please restart checkout.");
    }
  }

  async function start(params: Params = {}) {
    const current = ++generation;
    const thisRequest = ++request;
    const requestId = crypto.randomUUID();
    latestRequestId = requestId;
    pendingRequest = thisRequest;
    lastParams = params;
    dispose();
    view.show();
    view.retry(false);
    view.status("Preparing your checkout…");
    try {
      const island = await deps.mint({ ...params, requestId });
      if (current !== generation) {
        seen.add(island.sessionToken);
        return;
      }
      await open(island);
    } catch (error) {
      if (current === generation) fail(error instanceof Error ? error.message : "Could not prepare checkout. Please retry.");
    } finally {
      if (pendingRequest === thisRequest) pendingRequest = undefined;
    }
  }

  function close() {
    ++generation;
    latestRequestId = undefined;
    dismissedRequest = pendingRequest;
    dispose();
    view.hide();
    refresh();
  }

  return { open, start, close, retry: () => start(lastParams) };
}

/** Connect the controller to the existing plain-HTML screen. */
export function setupOnramp(deps: Omit<Dependencies, "view" | "loadKit">) {
  const dialog = document.getElementById("onramp-dialog") as HTMLDialogElement;
  const root = document.getElementById("onramp-root")!;
  const status = document.getElementById("onramp-status")!;
  const retry = document.getElementById("btn-onramp-retry") as HTMLButtonElement;
  const controller = createOnrampController({
    ...deps,
    view: {
      container: root,
      show: () => { if (!dialog.open) dialog.showModal(); },
      hide: () => { if (dialog.open) dialog.close(); root.replaceChildren(); },
      status: (message) => {
        status.textContent = message;
        document.getElementById("out-onramp")!.textContent = message;
      },
      retry: (visible) => { retry.hidden = !visible; },
      details: (island) => {
        const sandbox = island.environment === "sandbox";
        document.getElementById("onramp-mode")!.textContent = sandbox ? "Sandbox · No real money" : "Live checkout";
        document.getElementById("onramp-guidance")!.textContent = sandbox
          ? "Use test details only. Choose a test network in checkout. Arcie displays Arc balances; funds on other test networks will not appear here."
          : "Complete identity and payment steps here. Your wallet balance updates when funds arrive.";
        document.getElementById("onramp-destination")!.textContent = island.destinationAddress;
      },
    },
  });
  document.getElementById("btn-onramp-close")!.addEventListener("click", controller.close);
  dialog.addEventListener("cancel", (event) => { event.preventDefault(); controller.close(); });
  retry.addEventListener("click", () => { void controller.retry(); });
  return controller;
}
