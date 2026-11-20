// @vitest-environment happy-dom
import type { ConfirmIsland, IslandPayload } from "@arcie/core";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ActionSheet } from "./ActionSheet";
import { IslandsProvider } from "../lib/islands";
import { WalletScreen } from "../screens/Wallet";

vi.mock("@/lib/auth", () => ({ useAuth: () => ({ logout: vi.fn() }) }));
vi.mock("@elevenlabs/react", () => ({
  useConversationStatus: () => ({ status: "disconnected" }),
  useConversationControls: () => ({ sendContextualUpdate: vi.fn(), sendUserMessage: vi.fn() }),
}));

class Stream extends EventTarget {
  static current: Stream;
  constructor() { super(); Stream.current = this; }
  close() {}
}

const savingsAccount = { available: true, annualRate: 0.042, balance: "12.50", earned: "0.31" };
const confirm: ConfirmIsland = {
  kind: "confirm", intentId: "send-1", title: "Send 5 USD to Bob?", chips: ["Send", "USD", "Arc"],
  rows: [{ label: "Amount", value: "5 USD" }, { label: "To", value: "Bob" }],
  adjustments: [], risks: [], disclosure: [{ text: "Send 5 USD to Bob." }],
  buttons: { confirm: "Send money", cancel: "Keep money" },
  expiresAt: new Date(Date.now() + 600_000).toISOString(), spokenPrompt: "Confirm?",
};
let fetchMock: ReturnType<typeof vi.fn>;
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function wallet() {
  render(<IslandsProvider sessionId="test"><WalletScreen
    account={{ user: { id: "test", displayName: "Sam", email: null }, wallet: { address: "0x123", chain: "Arc_Testnet" } }}
    onSend={() => {}} onReceive={() => {}} onVoice={() => {}} onTool={() => {}}
  /><ActionSheet /></IslandsProvider>);
}
function publish(island: IslandPayload) {
  act(() => { Stream.current.dispatchEvent(new MessageEvent("island", { data: JSON.stringify(island) })); });
}

beforeEach(() => {
  vi.stubGlobal("EventSource", Stream);
  fetchMock = vi.fn(async (path: string) => {
    if (path === "/balances") return json({ chains: [{ tokens: [{ token: "USDC", amount: "100", usd: 100 }] }], totalUsd: 100 });
    if (path === "/savings") return json(savingsAccount);
    if (path === `/intents/${confirm.intentId}`) return json({ status: "awaiting_confirmation", island: confirm });
    throw new Error(`Unexpected request: ${path}`);
  });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("wallet savings", () => {
  it("projects the selected deposit at the current annual rate and blocks amounts above the wallet balance", async () => {
    wallet();
    fireEvent.click(await screen.findByRole("button", { name: "Deposit" }));
    const dialog = await screen.findByRole("dialog", { name: "Deposit to savings" });
    const deposit = within(dialog);
    expect(deposit.getByText("Available in wallet $100.00")).toBeTruthy();
    expect(deposit.queryByRole("img", { name: "Projected growth curve" })).toBeNull();
    expect(deposit.queryByText(/\$100\.00 example|assumes the same rate/i)).toBeNull();
    fireEvent.click(deposit.getByRole("button", { name: "$50" }));
    const amount = deposit.getByRole<HTMLInputElement>("textbox", { name: "Deposit amount" });
    expect(amount.value).toBe("50");
    expect(deposit.getByRole("img", { name: "Projected growth curve" })).toBeTruthy();
    expect(deposit.getByText("Starting balance").parentElement?.textContent).toContain("$50.00");
    expect(deposit.getByText("Projected ending balance").parentElement?.textContent).toContain("$52.10");
    const threeYears = deposit.getByRole("button", { name: "3 years" });
    fireEvent.click(threeYears);
    expect(threeYears.getAttribute("aria-pressed")).toBe("true");
    expect(deposit.getByText("Projected ending balance").parentElement?.textContent).toContain("$56.57");
    fireEvent.click(deposit.getByRole("button", { name: "5 years" }));
    expect(deposit.getByText("Projected ending balance").parentElement?.textContent).toContain("$61.42");
    fireEvent.change(amount, { target: { value: "100.000001" } });
    expect(deposit.getByRole<HTMLButtonElement>("button", { name: "Review deposit" }).disabled).toBe(true);
    fireEvent.change(amount, { target: { value: "" } });
    expect(deposit.queryByRole("img", { name: "Projected growth curve" })).toBeNull();
  });

  it("shows one dollar savings account and sends the deposit to review", async () => {
    wallet();
    const savings = await screen.findByRole("region", { name: "Savings" });
    expect(await within(savings).findByText("$12.50")).toBeTruthy();
    expect(within(savings).getByText("4.2% variable annual rate")).toBeTruthy();
    expect(within(savings).getByText("$0.31 earned")).toBeTruthy();
    expect(savings.textContent).not.toMatch(/vault|APY|position|USDC/i);
    fireEvent.click(within(savings).getByRole("button", { name: "Deposit" }));
    const amount = await screen.findByRole("textbox", { name: "Deposit amount" });
    expect((screen.getByRole("button", { name: "Review deposit" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(amount, { target: { value: "12.50" } });
    fetchMock.mockResolvedValueOnce(json({ island: { ...confirm, intentId: "deposit-1", title: "Deposit 12.50 USD?", chips: ["Invest", "USD"] } }));
    fireEvent.click(screen.getByRole("button", { name: "Review deposit" }));
    expect(await screen.findByRole("heading", { name: "Deposit 12.50 USD?" })).toBeTruthy();
    const writes = fetchMock.mock.calls.filter(([, init]) => init?.method === "POST");
    expect(writes).toHaveLength(1);
    expect(writes[0]?.[0]).toBe("/intents");
    expect(JSON.parse(writes[0]?.[1].body)).toEqual({ kind: "earn_deposit", params: { vault: "savings", amount: "12.50" } });
  });

  it.each([
    ["2.000416", "$2.00", "$2.000416"],
    ["0.000416", "Less than 1¢", "$0.000416"],
  ])("shows cents on the savings card and keeps the exact balance %s available for withdrawal", async (balance, display, exact) => {
    fetchMock.mockImplementation(async (path: string) => path === "/savings"
      ? json({ ...savingsAccount, balance, earned: "0.000279" }) : json({ chains: [], totalUsd: 0 }));
    wallet();
    const savings = screen.getByRole("region", { name: "Savings" });
    expect(await within(savings).findByText(display)).toBeTruthy();
    expect(within(savings).getByText("Less than 1¢ earned")).toBeTruthy();
    expect(savings.textContent).not.toContain(exact);
    fireEvent.click(within(savings).getByRole("button", { name: "Withdraw" }));
    await screen.findByText(`Available ${exact}`);
    fireEvent.click(screen.getByRole("button", { name: "Withdraw all" }));
    expect(screen.getByRole<HTMLInputElement>("textbox", { name: "Withdrawal amount" }).value).toBe(balance);
  });

  it("keeps deposits disabled when savings is unavailable", async () => {
    fetchMock.mockImplementation(async (path: string) => path === "/savings" ? json({ available: false, annualRate: null, balance: null, earned: null }) : json({ chains: [], totalUsd: 0 }));
    wallet();
    expect(await screen.findByText("Savings unavailable")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Deposit" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("lets the user retry a failed savings request", async () => {
    fetchMock.mockImplementation(async (path: string) => path === "/savings" ? json({ error: { message: "Unavailable" } }, 503) : json({ chains: [], totalUsd: 0 }));
    wallet();
    const retry = await screen.findByRole("button", { name: "Retry savings" });
    fetchMock.mockResolvedValueOnce(json(savingsAccount));
    fireEvent.click(retry);
    expect(await screen.findByText("4.2% variable annual rate")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Deposit" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it.each([null, 0])("handles an annual rate of %s while keeping the available account usable", async (annualRate) => {
    fetchMock.mockImplementation(async (path: string) => path === "/savings" ? json({ ...savingsAccount, annualRate, balance: null, earned: null }) : json({ chains: [], totalUsd: 0 }));
    wallet();
    const savings = screen.getByRole("region", { name: "Savings" });
    expect(await within(savings).findByText(annualRate === null ? "Annual rate unavailable" : "0% variable annual rate")).toBeTruthy();
    expect((within(savings).getByRole("button", { name: "Deposit" }) as HTMLButtonElement).disabled).toBe(false);
    expect(within(savings).queryByRole("button", { name: "Withdraw" })).toBeNull();
    expect(within(savings).queryByText(/earned/)).toBeNull();
  });

  it("blocks oversized withdrawals and sends the full-balance instruction only when selected", async () => {
    wallet();
    fireEvent.click(await screen.findByRole("button", { name: "Withdraw" }));
    const amount = screen.getByRole("textbox", { name: "Withdrawal amount" });
    fireEvent.change(amount, { target: { value: "12.500001" } });
    const review = screen.getByRole<HTMLButtonElement>("button", { name: "Review withdrawal" });
    expect(review.disabled).toBe(true);
    fireEvent.change(amount, { target: { value: "1.2550001" } });
    expect(review.disabled).toBe(true);
    fireEvent.change(amount, { target: { value: "5" } });
    expect(review.disabled).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Withdraw all" }));
    expect((amount as HTMLInputElement).readOnly).toBe(true);
    fetchMock.mockResolvedValueOnce(json({ island: { ...confirm, title: "Withdraw $12.50?" } }));
    fireEvent.click(review);
    await screen.findByRole("heading", { name: "Withdraw $12.50?" });
    const writes = fetchMock.mock.calls.filter(([, init]) => init?.method === "POST");
    expect(writes).toHaveLength(1);
    expect(JSON.parse(writes[0]?.[1].body)).toEqual({ kind: "earn_withdraw", params: { vault: "savings", amount: "all" } });
  });

  it("blocks duplicate deposit requests and preserves the amount after a rejected proposal", async () => {
    wallet();
    await screen.findByText("4.2% variable annual rate");
    fireEvent.click(screen.getByRole("button", { name: "Deposit" }));
    const amount = await screen.findByRole("textbox", { name: "Deposit amount" });
    fireEvent.change(amount, { target: { value: "10" } });
    let rejectDeposit!: (error: Error) => void;
    fetchMock.mockImplementationOnce(() => new Promise<Response>((_, reject) => { rejectDeposit = reject; }));
    const review = screen.getByRole("button", { name: "Review deposit" });
    fireEvent.click(review);
    fireEvent.click(review);
    await waitFor(() => expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1));
    expect((screen.getByRole("button", { name: "Preparing…" }) as HTMLButtonElement).disabled).toBe(true);
    expect((amount as HTMLInputElement).disabled).toBe(true);
    await act(async () => { rejectDeposit(new Error("Not enough balance.")); });
    expect(await screen.findByRole("alert")).toHaveProperty("textContent", "Not enough balance.");
    expect((amount as HTMLInputElement).value).toBe("10");
    expect((screen.getByRole("button", { name: "Review deposit" }) as HTMLButtonElement).disabled).toBe(false);
  });
});

it("puts the USD value first for each currency and shows a dollar unit price for USD", async () => {
  fetchMock.mockImplementation(async (path: string) => path === "/balances" ? json({
    totalUsd: 55.01,
    chains: [{ tokens: [
      { token: "USDC", amount: "17.37", usd: 17.37 },
      { token: "EURC", amount: "28.82", usd: 31.64, usdPrice: 1.1 },
      { token: "cirBTC", amount: "0.0001", usd: 6, usdPrice: 60035 },
    ] }],
  }) : json(savingsAccount));
  wallet();
  const currencies = await screen.findByRole("region", { name: "Currencies" });
  const rows = within(currencies).getAllByRole("listitem");
  for (const [index, price, value, amount] of [
    [0, "$1.00", "$17.37", "17.37"],
    [1, "$1.10", "$31.64", "28.82"],
    [2, "$60,035.00", "$6.00", "0.0001"],
  ] as const) {
    const row = within(rows[index]!);
    expect(row.getByText(price)).toBeTruthy();
    expect(row.getByText(value).compareDocumentPosition(row.getByText(amount)) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  }
});

it("keeps the savings deposit fee, risk and adjustment visible once in its review", async () => {
  render(<IslandsProvider sessionId="test"><ActionSheet /></IslandsProvider>);
  publish({
    ...confirm,
    action: "earn_deposit",
    title: "Add 5 USD to savings?",
    chips: ["Deposit", "USD"],
    rows: [
      { label: "Amount", value: "5 USD" },
      { label: "From", value: "Wallet" },
      { label: "To", value: "Savings" },
      { label: "Annual rate", value: "4.2%", estimate: true },
      { label: "Network fee", value: "0.0087 USD", estimate: true },
    ],
    adjustments: ["The amount was adjusted to 5 USD."],
    risks: ["The rate can change. You could lose money."],
    disclosure: [{ text: "You're adding 5 USD to savings. The rate can change. You could lose money." }],
  });
  const review = within(await screen.findByRole("dialog", { name: "Please confirm" }));
  expect(review.getByRole("heading", { name: "Add 5 USD to savings?" })).toBeTruthy();
  expect(review.getByText("Network fee")).toBeTruthy();
  expect(review.getByText("Annual rate")).toBeTruthy();
  expect(review.getByText("The amount was adjusted to 5 USD.")).toBeTruthy();
  expect(review.getAllByText(/The rate can change/)).toHaveLength(1);
  expect(review.queryByText("Amount", { selector: "dt" })).toBeNull();
  expect(review.queryByText("Send money")).toBeNull();
});

describe("send progress", () => {
  it("shows sending status until a real receipt arrives, including an executing response", async () => {
    render(<IslandsProvider sessionId="test"><ActionSheet /></IslandsProvider>);
    publish(confirm);
    fetchMock.mockResolvedValueOnce(json({ status: "executing", summary: "Still processing." }));
    fireEvent.click(await screen.findByRole("button", { name: "Confirm" }));
    const progress = await screen.findByRole("status");
    expect(progress.textContent).toContain("Sending on Arc");
    expect(progress.textContent).toContain("5 USD");
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(screen.queryByText("Done")).toBeNull();
    publish({ kind: "receipt", intentId: "send-1", status: "succeeded", rows: [], elapsedMs: 1000 });
    expect(await screen.findByText("Done", { selector: "p" })).toBeTruthy();
    expect(screen.queryByText("Sending on Arc…")).toBeNull();
  });

  it("returns to confirmation only after checking a failed submission is still awaiting approval", async () => {
    render(<IslandsProvider sessionId="test"><ActionSheet /></IslandsProvider>);
    publish(confirm);
    const approve = await screen.findByRole("button", { name: "Confirm" });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(`/intents/${confirm.intentId}`, expect.anything()));
    fetchMock.mockRejectedValueOnce(new Error("Connection lost."));
    fireEvent.click(approve);
    expect(await screen.findByRole("alert")).toHaveProperty("textContent", "Connection lost.");
    expect((await screen.findByRole<HTMLButtonElement>("button", { name: "Confirm" })).disabled).toBe(false);
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("ends pending progress with an error receipt when the transfer fails", async () => {
    render(<IslandsProvider sessionId="test"><ActionSheet /></IslandsProvider>);
    publish(confirm);
    fetchMock.mockResolvedValueOnce(json({ status: "executing" }));
    fireEvent.click(await screen.findByRole("button", { name: "Confirm" }));
    expect(await screen.findByRole("status")).toHaveProperty("textContent", expect.stringContaining("Sending on Arc"));
    publish({ kind: "receipt", intentId: "send-1", status: "failed", rows: [], elapsedMs: 1000, error: { code: "INSUFFICIENT_BALANCE", message: "Not enough balance." } });
    expect(await screen.findByRole("status")).toHaveProperty("textContent", expect.stringContaining("Didn't go through"));
    expect(screen.queryByText("Done", { selector: "p" })).toBeNull();
  });
});

it("keeps the most recent balance when an earlier refresh completes last", async () => {
  wallet();
  await screen.findByText("4.2% variable annual rate");
  let finish!: (value: Response) => void;
  fetchMock.mockImplementationOnce(() => new Promise<Response>(resolve => { finish = resolve; }));
  fireEvent.click(screen.getByRole("button", { name:"Refresh balance" }));
  await waitFor(() => expect(finish).toBeTypeOf("function"));
  fetchMock.mockResolvedValueOnce(json({ chains:[], totalUsd: 24 }));
  fireEvent.click(screen.getByRole("button", { name:"Refresh balance" }));
  await screen.findByText("$24.00");
  await act(async () => finish(json({ chains:[], totalUsd: 2 })));
  expect(screen.getByText("$24.00")).toBeTruthy();
});

it("recovers the receipt when a cancellation arrives after settlement", async () => {
  render(<IslandsProvider sessionId="test"><ActionSheet /></IslandsProvider>);
  publish(confirm);
  const cancel = await screen.findByRole("button", { name: "Cancel" });
  await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(`/intents/${confirm.intentId}`, expect.anything()));
  fetchMock.mockResolvedValueOnce(json({ cancelled:false, summary:"There's nothing to cancel." }));
  fetchMock.mockResolvedValueOnce(json({ status:"succeeded", island:{kind:"receipt", intentId:confirm.intentId, status:"succeeded", rows:[], elapsedMs:20} }));
  fireEvent.click(cancel);
  expect(await screen.findByText("Done", {selector:"p"})).toBeTruthy();
});
