import "./server-dom";
import type { OnrampIsland } from "@arcie/core";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { Window as TestWindow } from "happy-dom";
import { StrictMode, useState } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DEMO_WALLET, testApp } from "../../server/src/testkit";
import { OnrampSheet } from "../src/components/OnrampSheet";
import { setSessionId } from "../src/lib/api";
import { IslandsProvider, useIslands } from "../src/lib/islands";

const session = "checkout-test";
const origin = "https://onramp-sandbox.arc.io";
const frameTitle = "Circle secure deposit checkout";
let backend: Awaited<ReturnType<typeof testApp>>;

beforeEach(async () => {
  backend = await testApp();
  setSessionId(session);
  class LocalStream extends EventTarget {
    private unsubscribe: () => void;
    constructor(url: string) {
      super();
      const id = new URL(url, "http://localhost").searchParams.get("sessionId")!;
      this.unsubscribe = backend.bus.subscribe(id, (island) => {
        this.dispatchEvent(new MessageEvent("island", { data: JSON.stringify(island) }));
      });
    }
    close() { this.unsubscribe(); }
  }
  vi.stubGlobal("EventSource", LocalStream);
  vi.stubGlobal("fetch", vi.fn((path: string, init: RequestInit) => backend.app.request(path, init)));
  // Load a local empty document inside the real SDK iframe, so its validated source window exists.
  const settings = (window as unknown as TestWindow).happyDOM.settings;
  settings.enableIframePageLoading = true;
  settings.fetch.interceptor = { beforeAsyncRequest: async ({ window }) => new window.Response("<html></html>", { headers: { "content-type": "text/html" } }) };
});

afterEach(() => {
  cleanup();
  setSessionId(null);
  const settings = (window as unknown as TestWindow).happyDOM.settings;
  settings.enableIframePageLoading = false;
  settings.fetch.interceptor = null;
  vi.unstubAllGlobals();
});

function CheckoutHost() {
  const [open, setOpen] = useState(false);
  const { balanceTick } = useIslands();
  return <>
    <button onClick={() => setOpen(true)}>Add funds</button>
    <span data-testid="balance-refreshes">{balanceTick}</span>
    <OnrampSheet open={open} onOpenChange={setOpen} />
  </>;
}

function mount() {
  return render(<StrictMode><IslandsProvider sessionId={session}><CheckoutHost /></IslandsProvider></StrictMode>);
}

function callback(frame: HTMLIFrameElement, event: string, code: string, payload: Record<string, unknown>) {
  act(() => {
    window.dispatchEvent(new MessageEvent("message", { source: frame.contentWindow, origin, data: { event, code, payload } }));
  });
}

it("lets a user pick or edit a preset in either currency before opening checkout", async () => {
  mount();
  fireEvent.click(screen.getByRole("button", {name: "Add funds"}));
  const amount = await screen.findByLabelText(/amount to spend/i);
  const dollars = screen.getByRole("button", {name: "$50"});
  fireEvent.click(dollars);
  expect(amount).toHaveProperty("value", "50");
  expect(dollars.getAttribute("aria-pressed")).toBe("true");
  fireEvent.change(amount, {target: {value: "46.18"}});
  expect(dollars.getAttribute("aria-pressed")).toBe("false");
  fireEvent.change(screen.getByLabelText("Currency"), {target: {value: "EURC"}});
  expect(amount).toHaveProperty("value", "46.18");
  expect(screen.queryByRole("button", {name: "$50"})).toBeNull();
  fireEvent.click(screen.getByRole("button", {name: "€100"}));
  expect(amount).toHaveProperty("value", "100");
  expect(backend.kit.calls.filter(c => c.method === "createOnrampSession")).toHaveLength(0);
  fireEvent.click(screen.getByRole("button", {name: "Open checkout"}));
  expect(await screen.findByTitle(frameTitle)).toBeTruthy();
  expect(backend.kit.calls.filter(c => c.method === "createOnrampSession").map(c => c.params)).toEqual([
    { appUserId: "demo", destinationAddress: DEMO_WALLET.address, token: "EURC", amount: "100" },
  ]);
});

it("opens one checkout for button and stream delivery and records a submission without payment details", async () => {
  mount();
  let returnSession!: () => void;
  const holdResponse = new Promise<void>((resolve) => { returnSession = resolve; });
  vi.mocked(fetch).mockImplementationOnce(async (path, init) => {
    const response = await backend.app.request(String(path), init);
    await holdResponse;
    return response;
  });
  fireEvent.click(screen.getByRole("button", { name: "Add funds" }));
  fireEvent.change(await screen.findByLabelText(/amount to spend/i), { target: { value: ".50" } });
  fireEvent.change(screen.getByLabelText("Currency"), { target: { value: "EURC" } });
  fireEvent.click(screen.getByRole("button", { name: "Open checkout" }));
  const frame = await screen.findByTitle<HTMLIFrameElement>(frameTitle);
  await act(async () => { returnSession(); await vi.mocked(fetch).mock.results[0]!.value; });
  expect(new URL(frame.src).origin).toBe(origin);
  expect(screen.getAllByTitle(frameTitle)).toHaveLength(1);
  expect(screen.getByTitle(frameTitle)).toBe(frame);
  const destination = screen.getByText("Destination wallet").closest("details")!;
  expect(destination.open).toBe(false);
  fireEvent.click(destination.querySelector("summary")!);
  expect(destination.open).toBe(true);
  expect(await screen.findByText(DEMO_WALLET.address)).toBeTruthy();
  expect(screen.getByText(/sandbox · no real money/i)).toBeTruthy();
  expect(backend.kit.calls.filter((c) => c.method === "createOnrampSession").map((c) => c.params)).toEqual([
    { appUserId: "demo", destinationAddress: DEMO_WALLET.address, token: "EURC", amount: "0.50" },
  ]);
  callback(frame, "INITIALIZATION_SUCCESS", "INITIALIZATION_SUCCESS", {});
  await screen.findByText(/complete your deposit in the secure checkout/i);
  callback(frame, "DEPOSIT_SUBMITTED", "DEPOSIT_SUBMITTED", { settlementExpected: false, email: "private@example.test" });
  await screen.findByText(/sandbox submission complete/i);
  await waitFor(async () => {
    const { items } = await (await backend.call("GET", "/activity")).json();
    expect(items.filter((i: { type: string }) => i.type === "onramp.submitted")).toHaveLength(1);
    expect(items.some((i: { type: string }) => i.type === "onramp.settled")).toBe(false);
  });
  const posted = vi.mocked(fetch).mock.calls.find(([path]) => path === "/onramp/events");
  expect(JSON.parse(String(posted?.[1]?.body)).payload).toEqual({
    sessionId: new URL(frame.src).searchParams.get("sessionToken"), environment: "sandbox", code: "DEPOSIT_SUBMITTED", settlementExpected: false,
  });
  const before = Number(screen.getByTestId("balance-refreshes").textContent);
  expect(before).toBeGreaterThan(0);
  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  await waitFor(() => expect(document.querySelector("iframe")).toBeNull());
  expect(Number(screen.getByTestId("balance-refreshes").textContent)).toBeGreaterThan(before);
});

it("opens the voice tool's existing session, shows its spend amount and reports a later settlement", async () => {
  mount();
  await act(async () => {
    await backend.harness.runTool({
      userId: "demo", sessionId: session, channel: "voice", runId: "voice-checkout", userTurn: 1, now: () => new Date(),
    }, "start_onramp", { token: "USDC", amount: "25" });
  });
  const frame = await screen.findByTitle<HTMLIFrameElement>(frameTitle);
  expect(screen.getByText("25 USD")).toBeTruthy();
  expect(vi.mocked(fetch).mock.calls.some(([path]) => path === "/onramp/sessions")).toBe(false);
  callback(frame, "DEPOSIT_SETTLED", "DEPOSIT_SETTLED", { transactionHash: "0xf00" });
  expect(await screen.findByText(/check your wallet balance for received funds/i)).toBeTruthy();
  await waitFor(async () => {
    const { items } = await (await backend.call("GET", "/activity")).json();
    expect(items.map((i: { type: string }) => i.type)).toContain("onramp.settled");
  });
});

it("opens an expired voice session without minting and restarts with the original currency and amount", async () => {
  const app = mount();
  const island: OnrampIsland = {
    kind: "onramp", token: "EURC", amount: "9", destinationAddress: DEMO_WALLET.address, environment: "sandbox",
    sessionId: "old", sessionToken: "old", expiresAt: "2000-01-01T00:00:00Z", widgetUrl: origin + "/?sessionToken=old",
  };
  act(() => { backend.bus.publish(session, island); });
  expect(await screen.findByText(/checkout session expired/i)).toBeTruthy();
  expect(screen.queryByTitle(frameTitle)).toBeNull();
  expect(backend.kit.calls.filter((c) => c.method === "createOnrampSession")).toHaveLength(0);
  fireEvent.click(screen.getByRole("button", { name: "Restart checkout" }));
  const frame = await screen.findByTitle<HTMLIFrameElement>(frameTitle);
  expect(backend.kit.calls.filter((c) => c.method === "createOnrampSession").map((c) => c.params)).toEqual([
    { appUserId: "demo", destinationAddress: DEMO_WALLET.address, token: "EURC", amount: "9" },
  ]);
  app.unmount();
  callback(frame, "DEPOSIT_SETTLED", "DEPOSIT_SETTLED", { transactionHash: "stale" });
  expect(vi.mocked(fetch).mock.calls.some(([path]) => path === "/onramp/events")).toBe(false);
});

it("keeps a dismissed sheet closed when an outstanding checkout completes via REST and the stream", async () => {
  mount();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  vi.mocked(fetch).mockImplementationOnce(async (path, init) => {
    await gate;
    return backend.app.request(String(path), init);
  });
  fireEvent.click(screen.getByRole("button", { name: "Add funds" }));
  fireEvent.click(await screen.findByRole("button", { name: "Open checkout" }));
  await screen.findByText(/preparing your checkout/i);
  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  await act(async () => { release(); await vi.mocked(fetch).mock.results[0]!.value; });
  expect(backend.kit.calls.filter((c) => c.method === "createOnrampSession")).toHaveLength(1);
  expect(document.querySelector("iframe")).toBeNull();
  expect(screen.queryByRole("dialog")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Add funds" }));
  expect(await screen.findByRole("button", { name: "Open checkout" })).toBeTruthy();
});

it("keeps an invalid amount out of checkout and recovers from a session service error", async () => {
  mount();
  fireEvent.click(screen.getByRole("button", { name: "Add funds" }));
  const amount = await screen.findByLabelText(/amount to spend/i);
  const submit = screen.getByRole<HTMLButtonElement>("button", { name: "Open checkout" });
  fireEvent.change(amount, { target: { value: "0" } });
  expect(submit.disabled).toBe(true);
  fireEvent.change(amount, { target: { value: "" } });
  expect(submit.disabled).toBe(false);
  vi.mocked(fetch).mockRejectedValueOnce(new Error("Checkout service unavailable."));
  fireEvent.click(submit);
  expect(await screen.findByText("Checkout service unavailable.")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Restart checkout" }));
  expect(await screen.findByTitle(frameTitle)).toBeTruthy();
  expect(backend.kit.calls.filter(c => c.method === "createOnrampSession").map(c => c.params)).toEqual([
    { appUserId: "demo", destinationAddress: DEMO_WALLET.address, token: "USDC" },
  ]);
});
