/// <reference lib="dom" />
import { afterEach, describe, expect, it, vi } from "vitest";
import type { OnrampIsland } from "@arcie/core";
import { createOnrampController } from "./onramp.js";

const island: OnrampIsland = {
  kind: "onramp", sessionId: "checkout-1", sessionToken: "token-1",
  widgetUrl: "https://onramp-sandbox.arc.io/?sessionToken=token-1", environment: "sandbox",
  expiresAt: "2099-01-01T00:00:00Z", destinationAddress: "0x123", token: "USDC", amount: "20",
};

function setup() {
  let callbacks: any;
  const widget = { close: vi.fn() };
  const mountIframe = vi.fn((options: any) => { callbacks = options; return widget; });
  const view = { show: vi.fn(), hide: vi.fn(), status: vi.fn(), retry: vi.fn(), details: vi.fn(), container: {} as HTMLElement };
  const mint = vi.fn(async (_params: { token?: string; amount?: string; requestId: string }) => island);
  const record = vi.fn(async () => {});
  const refresh = vi.fn(async () => {});
  const loadKit = vi.fn(async () => ({ mountIframe }));
  const controller = createOnrampController({ view, mint, record, refresh, loadKit });
  return { controller, view, mint, record, refresh, loadKit, mountIframe, widget, callbacks: () => callbacks };
}

afterEach(() => vi.useRealTimers());

describe("sandbox checkout controller", () => {
  it("mounts once when the same session arrives through SSE and the button response", async () => {
    const s = setup();
    await s.controller.open(island);
    await s.controller.open(island);
    expect(s.mountIframe).toHaveBeenCalledTimes(1);
    expect(s.loadKit).toHaveBeenCalledWith("sandbox");
    expect(s.mountIframe.mock.calls[0]?.[0].session).toMatchObject({ sessionToken: "token-1", expiresAt: island.expiresAt, widgetUrl: island.widgetUrl });
    s.controller.close();
    expect(s.widget.close).toHaveBeenCalledTimes(1);
  });

  it("finishes a sandbox submission without claiming a deposit settled", async () => {
    const s = setup();
    await s.controller.open(island);
    s.callbacks().onDepositSubmitted({ event: "DEPOSIT_SUBMITTED", code: "OK", payload: { settlementExpected: false } });
    expect(s.view.status).toHaveBeenLastCalledWith(expect.stringContaining("Sandbox submission complete"));
    expect(s.view.retry).toHaveBeenLastCalledWith(false);
    expect(s.record).toHaveBeenCalledWith("submitted", expect.objectContaining({ sessionId: "checkout-1", settlementExpected: false }));
    expect(s.record).not.toHaveBeenCalledWith("settled", expect.anything());
    expect(s.refresh).toHaveBeenCalled();
    s.controller.close();
  });

  it("does not reopen a dismissed checkout when its session request finishes", async () => {
    const s = setup();
    let finish!: (value: OnrampIsland) => void;
    s.mint.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    const pending = s.controller.start({ token: "USDC" });
    s.controller.close();
    await s.controller.open(island); // late SSE from the same request
    finish(island);
    await pending;
    expect(s.mountIframe).not.toHaveBeenCalled();
    expect(s.view.show).toHaveBeenCalledTimes(1);
  });

  it("lets SSE open a session while a button request is in flight without remounting", async () => {
    const s = setup();
    let finish!: (value: OnrampIsland) => void;
    s.mint.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    const pending = s.controller.start({ token: "USDC" });
    await s.controller.open(island);
    finish(island);
    await pending;
    expect(s.mountIframe).toHaveBeenCalledTimes(1);
    s.controller.close();
  });

  it("ignores a late SSE from a dismissed retry after a newer checkout starts", async () => {
    const s = setup();
    const pending: { requestId: string; resolve(value: OnrampIsland): void }[] = [];
    s.mint.mockImplementation((params) => new Promise((resolve) => { pending.push({ requestId: params.requestId, resolve }); }));
    const first = s.controller.start({ amount: "10" });
    s.controller.close();
    const second = s.controller.start({ amount: "20" });
    const old = { ...island, requestId: pending[0]!.requestId };
    const next = { ...island, sessionToken: "next", sessionId: "next", requestId: pending[1]!.requestId };
    await s.controller.open(old);
    pending[0]!.resolve(old);
    pending[1]!.resolve(next);
    await Promise.all([first, second]);
    expect(s.mountIframe).toHaveBeenCalledTimes(1);
    expect(s.mountIframe.mock.calls[0]?.[0].session.sessionToken).toBe("next");
    s.controller.close();
  });

  it("supports cancel and retry without posting the customer's identity/payment payload", async () => {
    const s = setup();
    await s.controller.open(island);
    s.callbacks().onDepositNotCompleted({ code: "CANCELED_BY_CUSTOMER", payload: { email: "private@example.com", cardNumber: "private" } });
    expect(s.view.status).toHaveBeenLastCalledWith(expect.stringContaining("cancelled"));
    expect(s.view.retry).toHaveBeenLastCalledWith(true);
    expect(s.record).toHaveBeenCalledWith("failed", { sessionId: "checkout-1", environment: "sandbox", code: "CANCELED_BY_CUSTOMER" });
    s.controller.close();
  });

  it("does not mount after closing while the SDK loads", async () => {
    const s = setup();
    let finish!: (kit: { mountIframe: typeof s.mountIframe }) => void;
    s.loadKit.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    const pending = s.controller.open(island);
    s.controller.close();
    finish({ mountIframe: s.mountIframe });
    await pending;
    expect(s.mountIframe).not.toHaveBeenCalled();
  });

  it("offers a fresh session after expiry without automatically looping", async () => {
    const s = setup();
    await s.controller.open({ ...island, expiresAt: "2000-01-01T00:00:00Z" });
    expect(s.mountIframe).not.toHaveBeenCalled();
    expect(s.view.retry).toHaveBeenLastCalledWith(true);
    expect(s.mint).not.toHaveBeenCalled();
    s.mint.mockResolvedValue({ ...island, sessionToken: "fresh", sessionId: "new" });
    await s.controller.retry();
    expect(s.mountIframe).toHaveBeenCalledTimes(1);
    s.controller.close();
  });

  it("ignores events from a replaced widget and recovers from initialization errors", async () => {
    const s = setup();
    await s.controller.open(island);
    const old = s.callbacks();
    await s.controller.open({ ...island, sessionToken: "new", sessionId: "new" });
    old.onDepositSettled({ payload: { transactionHash: "old" } });
    expect(s.record).not.toHaveBeenCalled();
    s.callbacks().onInitializationError({ code: "INVALID_SESSION_TOKEN" });
    expect(s.view.retry).toHaveBeenLastCalledWith(true);
    expect(s.view.status).toHaveBeenLastCalledWith(expect.stringContaining("restart"));
    s.controller.close();
  });
});
