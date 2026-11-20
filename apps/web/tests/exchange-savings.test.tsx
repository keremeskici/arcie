// @vitest-environment node
import "./server-dom";
import { ConversationProvider } from "@elevenlabs/react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DEMO_WALLET, testApp } from "../../server/src/testkit";
import { ActionSheet } from "../src/components/ActionSheet";
import { SavingsIsland } from "../src/components/SavingsIsland";
import { SendSheet } from "../src/components/SendSheet";
import { SwapSheet } from "../src/components/SwapSheet";
import { setSessionId } from "../src/lib/api";
import { IslandsProvider } from "../src/lib/islands";

let backend: Awaited<ReturnType<typeof testApp>>;
class OfflineStream extends EventTarget { close() {} }

beforeEach(async () => {
  backend = await testApp();
  setSessionId("money-test");
  vi.stubGlobal("EventSource", OfflineStream);
  vi.stubGlobal("fetch", vi.fn((path: string, init: RequestInit) => backend.app.request(path, init)));
});
afterEach(() => {
  cleanup();
  setSessionId(null);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function Actions({ kind }: { kind: "send" | "swap" | "savings" }) {
  const [open, setOpen] = useState(true);
  return <>
    {kind === "send" && <SendSheet open={open} onOpenChange={setOpen} />}
    {kind === "swap" && open && <SwapSheet onClose={() => setOpen(false)} />}
    {kind === "savings" && <SavingsIsland />}
    <ActionSheet />
  </>;
}
function show(kind: "send" | "swap" | "savings") {
  render(<IslandsProvider sessionId="money-test"><ConversationProvider><Actions kind={kind} /></ConversationProvider></IslandsProvider>);
}
function fill(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}
const button = (name: string) => screen.getByRole<HTMLButtonElement>("button", { name });

it("prepares the whole BTC balance for an explicitly selected contact even when names overlap", async () => {
  backend.kit.setBalance(DEMO_WALLET, "cirBTC", "0.00000123");
  show("send");
  expect(screen.queryByRole("button", { name: /^Alice 0x1111/ })).toBeNull();
  fireEvent.click(button("Contacts"));
  const alice = await screen.findByRole("button", { name: /^Alice 0x1111/ });
  fireEvent.click(alice);
  fireEvent.click(button("BTC"));
  fireEvent.click(button("Send all"));
  await waitFor(() => expect((screen.getByLabelText("Amount") as HTMLInputElement).value).toBe("0.00000123"));
  fireEvent.click(button("Review"));
  expect(await screen.findByRole("heading", { name: "Send 0.00000123 cirBTC to Alice" })).toBeTruthy();
  expect((await backend.harness.intents.listForUser("demo", 1))[0]?.params).toMatchObject({ token: "cirBTC", recipientLabel: "Alice" });
  expect(backend.kit.calls).toEqual([]);
  fireEvent.click(button("Confirm"));
  await screen.findByRole("link", { name: "View on explorer" });
  expect(backend.kit.calls).toEqual([{ method: "send", params: { to: "0x1111111111111111111111111111111111111111", amount: "0.00000123", token: "cirBTC" } }]);
});

it("keeps a freeform ambiguous send available to the shared choice card", async () => {
  show("send");
  await screen.findByRole("button", { name: "Contacts" });
  fill("To", "Ali");
  fill("Amount", "1");
  fireEvent.click(button("Review"));
  expect(await screen.findByText("Which contact did you mean?")).toBeTruthy();
  expect(await backend.harness.intents.listForUser("demo", 2)).toHaveLength(0);
});

async function expectEstimate(value: string) {
  await waitFor(() => expect(screen.getByLabelText("Estimated receive amount").textContent).toBe(value));
}

function swapPaths(path: string) {
  return vi.mocked(fetch).mock.calls.filter(([url]) => url === path);
}

it("quotes the current amount automatically and swaps once using the displayed minimum", async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  vi.mocked(fetch).mockImplementation(async (path, init) => {
    if (path === "/swaps") await gate;
    return backend.app.request(String(path), init);
  });
  show("swap");
  fill("Swap amount", "10");
  await expectEstimate("9.2 EUR");
  fill("Receive currency", "cirBTC");
  expect(screen.getByLabelText("Estimated receive amount").textContent).toBe("—");
  expect(button("Swap").disabled).toBe(true);
  await expectEstimate("0.0001 BTC");
  expect(screen.getByText("0.000099 BTC")).toBeTruthy();
  expect(screen.queryByText(/slippage|settings|get quote|review swap/i)).toBeNull();
  expect(await backend.harness.intents.listForUser("demo", 2)).toHaveLength(0);
  const swap = button("Swap");
  fireEvent.click(swap);
  fireEvent.click(swap);
  expect(button("Swapping…").disabled).toBe(true);
  expect(screen.getByLabelText("Swap amount")).toHaveProperty("disabled", true);
  await waitFor(() => expect(swapPaths("/swaps")).toHaveLength(1));
  const body = JSON.parse(String(swapPaths("/swaps")[0]?.[1]?.body));
  expect(body).toEqual({ tokenIn: "USDC", tokenOut: "cirBTC", amountIn: "10", minOut: "0.000099", requestId: expect.stringMatching(/^[a-f0-9-]{36}$/i) });
  await act(async () => release());
  await screen.findByRole("button", { name: "Done" });
  expect(screen.queryByRole("button", { name: "Confirm" })).toBeNull();
  expect(backend.kit.calls.map((c) => c.method)).toEqual(["swap"]);
});

it("refreshes quotes every half second, skips overlapping calls and discards a response for an old amount", async () => {
  const old = Promise.withResolvers<Response>();
  vi.mocked(fetch).mockImplementationOnce(() => old.promise);
  show("swap");
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
  try {
    fill("Swap amount", "10");
    await act(async () => {});
    expect(swapPaths("/quotes/swap")).toHaveLength(1);
    await act(() => vi.advanceTimersByTimeAsync(1500));
    expect(swapPaths("/quotes/swap")).toHaveLength(1);
    const oldSignal = swapPaths("/quotes/swap")[0]?.[1]?.signal;
    fill("Swap amount", "3");
    expect(oldSignal?.aborted).toBe(true);
    await expectEstimate("2.76 EUR");
    await act(async () => { old.resolve(Response.json({ data: { estimatedOut: "9.2", minOut: "9.108", fees: [] } })); });
    await expectEstimate("2.76 EUR");
    const before = swapPaths("/quotes/swap").length;
    await act(() => vi.advanceTimersByTimeAsync(499));
    expect(swapPaths("/quotes/swap")).toHaveLength(before);
    backend.kit.setSwapRate("USDC", "EURC", 0.8);
    await act(() => vi.advanceTimersByTimeAsync(1));
    await expectEstimate("2.4 EUR");
    expect(swapPaths("/quotes/swap")).toHaveLength(before + 1);
    fill("Swap amount", "");
    await act(() => vi.advanceTimersByTimeAsync(1100));
    expect(swapPaths("/quotes/swap")).toHaveLength(before + 1);
  } finally { vi.useRealTimers(); }
});

it("aborts a stalled quote and publishes only a fresh estimate", async () => {
  vi.mocked(fetch).mockImplementationOnce(() => new Promise<Response>(() => {}));
  show("swap");
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "setTimeout", "clearTimeout"] });
  try {
    fill("Swap amount", "5");
    await act(async () => {});
    const signal = swapPaths("/quotes/swap")[0]?.[1]?.signal;
    await act(() => vi.advanceTimersByTimeAsync(10_500));
    expect(signal?.aborted).toBe(true);
    vi.useRealTimers();
    await expectEstimate("4.6 EUR");
    expect(swapPaths("/swaps")).toHaveLength(0);
  } finally { vi.useRealTimers(); }
});

it("pauses quotes when the document is hidden and refuses a zero minimum", async () => {
  const hidden = vi.spyOn(document, "visibilityState", "get");
  show("swap");
  fill("Receive currency", "cirBTC");
  fill("Swap amount", "0.000001");
  await screen.findByRole("alert");
  expect(button("Swap").disabled).toBe(true);
  hidden.mockReturnValue("hidden");
  act(() => document.dispatchEvent(new Event("visibilitychange")));
  fill("Swap amount", "10");
  const count = swapPaths("/quotes/swap").length;
  await act(() => new Promise(resolve => setTimeout(resolve, 550)));
  expect(swapPaths("/quotes/swap")).toHaveLength(count);
  hidden.mockReturnValue("visible");
  act(() => document.dispatchEvent(new Event("visibilitychange")));
  await expectEstimate("0.0001 BTC");
  expect(button("Swap").disabled).toBe(false);
});

it("summarizes precise provider fees and exposes the original amount on demand", async () => {
  vi.mocked(fetch).mockImplementation(async (path, init) => {
    if (path === "/quotes/swap") return Response.json({ data: {
      estimatedOut: "4.6", minOut: "4.554",
      fees: [{ label: "Network fee", amount: "0.024822247732504687", token: "USDC" },
        { label: "Service fee", amount: "0.00000089", token: "USDC" }],
    } });
    return backend.app.request(String(path), init);
  });
  show("swap");
  fill("Swap amount", "5");
  const fee = await screen.findByText("≈ $0.025");
  expect(screen.getByText("<$0.0001")).toBeTruthy();
  const details = fee.closest("details")!;
  expect(details.open).toBe(false);
  fireEvent.click(fee.closest("summary")!);
  expect(details.open).toBe(true);
  expect(details.textContent).toContain("0.024822247732504687 USD");
});

it("requires another tap on a fresh price after the market moves, using a new request ID", async () => {
  show("swap");
  fill("Swap amount", "10");
  await expectEstimate("9.2 EUR");
  backend.kit.setSwapRate("USDC", "EURC", 0.5);
  fireEvent.click(button("Swap"));
  expect(await screen.findByRole("alert")).toHaveProperty("textContent", expect.stringMatching(/price|rate/i));
  await expectEstimate("5 EUR");
  expect(backend.kit.calls).toEqual([]);
  expect(swapPaths("/swaps")).toHaveLength(1);
  fireEvent.click(button("Swap"));
  await screen.findByRole("button", { name: "Done" });
  const requests = swapPaths("/swaps").map(([, init]) => JSON.parse(String(init?.body)));
  expect(requests[0].requestId).not.toBe(requests[1].requestId);
  expect(requests[1].minOut).toBe("4.95");
  expect(backend.kit.calls.map((c) => c.method)).toEqual(["swap"]);
});

it("recovers a lost POST response from the saved receipt without another submission", async () => {
  vi.mocked(fetch).mockImplementation(async (path, init) => {
    const response = await backend.app.request(String(path), init);
    if (path === "/swaps") throw new TypeError("Connection lost");
    return response;
  });
  show("swap");
  fill("Swap amount", "2");
  await expectEstimate("1.84 EUR");
  fireEvent.click(button("Swap"));
  await screen.findByRole("button", { name: "Done" });
  expect(swapPaths("/swaps")).toHaveLength(1);
  expect(backend.kit.calls.map((c) => c.method)).toEqual(["swap"]);
});

it("reuses the same request on an explicit retry after a dropped request and empty status lookup", async () => {
  let disconnect = true;
  vi.mocked(fetch).mockImplementation(async (path, init) => {
    if (path === "/swaps" && disconnect) { disconnect = false; throw new TypeError("Offline"); }
    return backend.app.request(String(path), init);
  });
  show("swap");
  fill("Swap amount", "2");
  await expectEstimate("1.84 EUR");
  fireEvent.click(button("Swap"));
  fireEvent.click(await screen.findByRole("button", { name: "Retry swap" }));
  await screen.findByRole("button", { name: "Done" });
  const requests = swapPaths("/swaps");
  expect(requests).toHaveLength(2);
  expect(requests[1]?.[1]?.body).toBe(requests[0]?.[1]?.body);
  expect(backend.kit.calls.map((c) => c.method)).toEqual(["swap"]);
});

it("keeps a pending swap in progress until its actual settled receipt", async () => {
  backend.kit.setPendingNext();
  show("swap");
  fill("Swap amount", "2");
  await expectEstimate("1.84 EUR");
  fireEvent.click(button("Swap"));
  await screen.findByRole("button", { name: "Check later in Activity" });
  expect(button("Swapping…").disabled).toBe(true);
  expect(screen.queryByRole("button", { name: "Done" })).toBeNull();
  const intent = (await backend.harness.intents.listForUser("demo", 1))[0]!;
  backend.kit.settle(intent.txHash!, "DONE");
  await screen.findByRole("button", { name: "Done" }, { timeout: 6000 });
  expect(swapPaths("/swaps")).toHaveLength(1);
  expect(backend.kit.calls.map((c) => c.method)).toEqual(["swap"]);
});

it("shows the real failed receipt when the provider rejects the swap", async () => {
  backend.kit.failNext("INSUFFICIENT_BALANCE");
  show("swap");
  fill("Swap amount", "2");
  await expectEstimate("1.84 EUR");
  fireEvent.click(button("Swap"));
  await screen.findByText("Didn't go through");
  expect(swapPaths("/swaps")).toHaveLength(1);
});

const savingsAddress = "0xaabbef1d3971c710276ed41ec791bbe14cdb8e88";

it("deposits into savings and refreshes the dollar balance after the receipt", async () => {
  show("savings");
  await screen.findByText("4.2% variable annual rate");
  fireEvent.click(button("Deposit"));
  fill("Deposit amount", "2.35");
  fireEvent.click(button("Review deposit"));
  expect(await screen.findByRole("heading", { name: /2\.35/ })).toBeTruthy();
  expect((await backend.harness.intents.listForUser("demo", 1))[0]).toMatchObject({
    kind: "earn_deposit", params: { token: "USDC", amount: "2.35" },
  });
  expect(backend.kit.calls).toEqual([]);
  fireEvent.click(button("Confirm"));
  await screen.findByRole("button", { name: "Done" });
  fireEvent.click(button("Done"));
  expect(await screen.findByText("$2.35")).toBeTruthy();
  expect(button("Withdraw")).toBeTruthy();
  expect(backend.kit.calls).toEqual([{ method: "deposit", params: { vault: savingsAddress, amount: "2.35" } }]);
});

it.each([["2.1", "2.1", "$4.20"], ["all", "6.3", "$0.00"]])("shows earnings and withdraws %s from the same savings account", async (selection, expected, remaining) => {
  await backend.kit.deposit(DEMO_WALLET, { vault: savingsAddress, amount: "6.3" });
  show("savings");
  expect(await screen.findByText("$6.30")).toBeTruthy();
  expect(screen.getByText("$0.00 earned")).toBeTruthy();
  fireEvent.click(button("Withdraw"));
  if (selection === "all") fireEvent.click(button("Withdraw all"));
  else fill("Withdrawal amount", selection);
  fireEvent.click(button("Review withdrawal"));
  await screen.findByRole("heading", { name: new RegExp(expected) });
  expect((await backend.harness.intents.listForUser("demo", 1))[0]).toMatchObject({
    kind: "earn_withdraw", params: { token: "USDC", amount: expected },
  });
  expect(backend.kit.calls.map((c) => c.method)).toEqual(["deposit"]);
  fireEvent.click(button("Confirm"));
  await screen.findByRole("button", { name: "Done" });
  fireEvent.click(button("Done"));
  expect(await screen.findByText(remaining)).toBeTruthy();
  if (selection === "all") expect(screen.queryByRole("button", { name: "Withdraw" })).toBeNull();
});
