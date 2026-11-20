// @vitest-environment node
import "./server-dom";
import { fireEvent } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { testApp } from "../../server/src/testkit";

let backend: Awaited<ReturnType<typeof testApp>>;
let events: EventTarget;
let requests: ReturnType<typeof vi.fn<(path: string, init: RequestInit) => Promise<Response>>>;
const field = (id: string) => document.getElementById(id) as HTMLInputElement;
const swap = () => document.getElementById("btn-swap") as HTMLButtonElement;
const tab = (name: string) => fireEvent.click(document.querySelector('[data-tab="' + name + '"]')!);
const quoteCalls = () => requests.mock.calls.filter(([path]) => path === "/quotes/swap");
const submits = () => requests.mock.calls.filter(([path]) => path === "/swaps").map(([, init]) => JSON.parse(String(init.body)));

beforeEach(async () => {
  backend = await testApp();
  const html = await (await backend.app.request("/")).text();
  const page = new DOMParser().parseFromString(html, "text/html");
  const script = page.querySelector('script[type="module"]')!;
  const code = script.textContent.replace('import { setupOnramp } from "/assets/onramp.js";', "");
  script.remove();
  document.body.innerHTML = page.body.innerHTML;
  vi.stubGlobal("EventSource", class extends EventTarget {
    constructor() { super(); events = this; }
    close() {}
  });
  requests = vi.fn((path: string, init: RequestInit) => backend.app.request(path, init));
  vi.stubGlobal("fetch", requests);
  await Function("setupOnramp", code.replace("    boot();", "    return boot();"))(() => ({}));
  vi.useFakeTimers();
});
afterEach(() => {
  tab("overview");
  document.onvisibilitychange = null;
  window.onpagehide = null;
  window.onpageshow = null;
  vi.useRealTimers();
  vi.restoreAllMocks();
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

it("refreshes quotes at 500ms only in the foreground and discards superseded results", async () => {
  await vi.advanceTimersByTimeAsync(2000);
  expect(quoteCalls()).toHaveLength(0);
  tab("swap");
  expect(swap().disabled).toBe(true);
  await vi.advanceTimersByTimeAsync(499);
  expect(quoteCalls()).toHaveLength(0);
  await vi.advanceTimersByTimeAsync(1);
  expect(quoteCalls()).toHaveLength(1);
  expect(swap().disabled).toBe(false);
  expect(field("out-swap-quote").textContent).toContain("1.84 EURC");
  backend.kit.setSwapRate("USDC", "EURC", 0.95);
  await vi.advanceTimersByTimeAsync(500);
  expect(quoteCalls()).toHaveLength(2);
  expect(field("out-swap-quote").textContent).toContain("1.9 EURC");
  let release!: () => void;
  const hold = new Promise<void>(resolve => { release = resolve; });
  requests.mockImplementationOnce(async (path, init) => { await hold; return backend.app.request(path, init); });
  await vi.advanceTimersByTimeAsync(500);
  await vi.advanceTimersByTimeAsync(2500);
  expect(quoteCalls()).toHaveLength(3);
  fireEvent.input(field("swap-amount"), {target:{value:"0"}});
  expect(swap().disabled).toBe(true);
  tab("overview");
  release();
  await vi.advanceTimersByTimeAsync(3000);
  expect(quoteCalls()).toHaveLength(3);
  expect(field("out-swap-quote").textContent).not.toContain("1.9 EURC");
  tab("swap");
  await vi.advanceTimersByTimeAsync(1000);
  expect(quoteCalls()).toHaveLength(3);
});

it("stops quoting a hidden browser tab and resumes with current settings", async () => {
  const hidden = vi.spyOn(document, "hidden", "get").mockReturnValue(false);
  tab("swap");
  await vi.advanceTimersByTimeAsync(500);
  expect(quoteCalls()).toHaveLength(1);
  hidden.mockReturnValue(true);
  fireEvent(document, new Event("visibilitychange"));
  expect(swap().disabled).toBe(true);
  await vi.advanceTimersByTimeAsync(5000);
  expect(quoteCalls()).toHaveLength(1);
  hidden.mockReturnValue(false);
  fireEvent(document, new Event("visibilitychange"));
  await vi.advanceTimersByTimeAsync(500);
  expect(quoteCalls()).toHaveLength(2);
  expect(JSON.parse(String(quoteCalls()[1]![1].body))).toEqual({ tokenIn: "USDC", tokenOut: "EURC", amountIn: "2" });
  expect(swap().disabled).toBe(false);
});

it("submits the displayed floor once and follows a processing swap to its real receipt", async () => {
  tab("swap");
  await vi.advanceTimersByTimeAsync(500);
  backend.kit.setPendingNext();
  const quoted = await (await backend.call("POST", "/quotes/swap", {tokenIn:"USDC", tokenOut:"EURC", amountIn:"2"})).json();
  fireEvent.click(swap());
  fireEvent.click(swap());
  expect(swap().disabled).toBe(true);
  await vi.advanceTimersByTimeAsync(0);
  expect(submits()).toEqual([{requestId:expect.any(String), tokenIn:"USDC", tokenOut:"EURC", amountIn:"2", minOut:quoted.data.minOut}]);
  const intent = backend.harness.intents.get(submits()[0].requestId)!;
  expect(intent.status).toBe("executing");
  expect(field("out-swap-status").textContent).toMatch(/processing|pending/i);
  expect(field("island-receipt").textContent).not.toMatch(/succeeded/i);
  tab("overview");
  backend.kit.settle(intent.txHash!);
  await vi.advanceTimersByTimeAsync(5000);
  expect(quoteCalls()).toHaveLength(1);
  tab("swap");
  await vi.advanceTimersByTimeAsync(5000);
  expect(field("out-swap-status").textContent).toMatch(/complete/i);
  expect(field("island-receipt").textContent).toMatch(/receipt: succeeded/i);
  expect(backend.kit.calls.map(c => c.method)).toEqual(["swap"]);
});

it("refreshes a worsening quote and requires a new tap before exchanging", async () => {
  tab("swap");
  await vi.advanceTimersByTimeAsync(500);
  backend.kit.setSwapRate("USDC", "EURC", 0.8);
  fireEvent.click(swap());
  await vi.advanceTimersByTimeAsync(500);
  expect(field("out-swap-status").textContent).toMatch(/price changed/i);
  expect(backend.kit.calls).toEqual([]);
  expect(field("out-swap-quote").textContent).toContain("1.6 EURC");
  fireEvent.click(swap());
  await vi.advanceTimersByTimeAsync(0);
  expect(submits()[1].requestId).not.toBe(submits()[0].requestId);
  expect(backend.kit.calls.map(c => c.method)).toEqual(["swap"]);
});

it("reuses the request ID and accepted floor when retrying an unacknowledged submission", async () => {
  tab("swap");
  await vi.advanceTimersByTimeAsync(500);
  requests.mockRejectedValueOnce(new Error("Offline"));
  fireEvent.click(swap());
  await vi.advanceTimersByTimeAsync(4000);
  expect(submits()).toHaveLength(1);
  expect(backend.kit.calls).toEqual([]);
  expect(swap().textContent).toMatch(/retry/i);
  fireEvent.click(swap());
  await vi.advanceTimersByTimeAsync(0);
  expect(submits()[1]).toEqual(submits()[0]);
  expect(backend.kit.calls.map(c => c.method)).toEqual(["swap"]);
});

it("honors the streamed receipt even when the submit response is lost", async () => {
  backend.bus.subscribe(field("inp-session-id").value, island => {
    events.dispatchEvent(new MessageEvent("island", { data: JSON.stringify(island) }));
  });
  tab("swap");
  await vi.advanceTimersByTimeAsync(500);
  requests.mockImplementationOnce(async (path, init) => {
    await backend.app.request(path, init);
    throw new Error("Connection dropped after execution");
  });
  fireEvent.click(swap());
  await vi.advanceTimersByTimeAsync(5000);
  expect(field("out-swap-status").textContent).toBe("Swap complete.");
  expect(field("island-receipt").textContent).toMatch(/receipt: succeeded/i);
  expect(swap().disabled).toBe(true);
  expect(submits()).toHaveLength(1);
  expect(backend.kit.calls.map(c => c.method)).toEqual(["swap"]);
});
