// @vitest-environment node
import "./server-dom";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { testApp } from "../../server/src/testkit";
import { AccountSheet, ActivitySheet, ContactsSheet } from "../src/components/AccountSheets";
import { IslandsProvider, useIslands } from "../src/lib/islands";
import { setSessionId } from "../src/lib/api";

class OfflineStream extends EventTarget { close() {} }
let backend: Awaited<ReturnType<typeof testApp>>;
const headers = { "x-arcie-session": "account-test" };
const address = "0x000000000000000000000000000000000000dEaD";

beforeEach(async () => {
  backend = await testApp();
  setSessionId("account-test");
  vi.stubGlobal("EventSource", OfflineStream);
  vi.stubGlobal("fetch", vi.fn((path: string, init: RequestInit) => backend.app.request(path, init)));
});
afterEach(() => {
  cleanup();
  setSessionId(null);
  vi.unstubAllGlobals();
});

function ActivityHost() {
  const [open, setOpen] = useState(true);
  const { confirm, receipt } = useIslands();
  return <>
    {open && <ActivitySheet onClose={() => setOpen(false)} />}
    {confirm && <p>{confirm.title}</p>}
    {receipt && <p>{receipt.status} receipt {receipt.intentId}</p>}
  </>;
}

function activity() {
  render(<IslandsProvider sessionId="account-test"><ActivityHost /></IslandsProvider>);
}
async function propose(customHeaders = headers) {
  const response = await backend.call("POST", "/intents", { kind: "send", params: { to: "Bob", amount: "5", token: "USDC" } }, customHeaders);
  expect(response.status).toBe(200);
  return (await response.json()).island.intentId as string;
}

it("loads account identity, the full managed address and every policy setting after retry", async () => {
  vi.mocked(fetch).mockRejectedValueOnce(new Error("Wallet service unavailable."));
  render(<AccountSheet onClose={() => {}} />);
  expect(await screen.findByText("Wallet service unavailable.")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: /retry/i }));
  expect(await screen.findByText(address)).toBeTruthy();
  for (const value of ["Demo", "demo", "$50.00", "$200.00", "1%", "USD, EUR, BTC", "Required", "Account database"]) {
    expect(screen.getByText(value, { exact: true })).toBeTruthy();
  }
  expect(screen.getByText(/Send, Swap, Savings deposit, Savings withdrawal/)).toBeTruthy();
});

it("shows full selected contact addresses and persists a new contact through the API", async () => {
  render(<ContactsSheet onClose={() => {}} />);
  fireEvent.click(await screen.findByRole("button", { name: /Bob/ }));
  expect(await screen.findByText("0x3333333333333333333333333333333333333333")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Add contact" }));
  const name = screen.getByLabelText("Name");
  const wallet = screen.getByLabelText("Wallet address");
  fireEvent.change(name, { target: { value: "Bob" } });
  fireEvent.change(wallet, { target: { value: address } });
  fireEvent.click(screen.getByRole("button", { name: "Save contact" }));
  expect(await screen.findByRole("alert")).toHaveProperty("textContent", expect.stringMatching(/already/i));
  fireEvent.change(name, { target: { value: "Caroline" } });
  fireEvent.change(wallet, { target: { value: "0x123" } });
  fireEvent.click(screen.getByRole("button", { name: "Save contact" }));
  expect(await screen.findByRole("alert")).toHaveProperty("textContent", expect.stringMatching(/address/i));
  fireEvent.change(wallet, { target: { value: address.toLowerCase() } });
  fireEvent.click(screen.getByRole("button", { name: "Save contact" }));
  expect(await screen.findByRole("alert")).toHaveProperty("textContent", expect.stringMatching(/checksum/i));
  fireEvent.change(wallet, { target: { value: address } });
  fireEvent.click(screen.getByRole("button", { name: "Save contact" }));
  expect(await screen.findByText(address)).toBeTruthy();
  expect(screen.getByRole("button", { name: /Caroline/ })).toBeTruthy();
  const saved = await (await backend.call("GET", "/contacts")).json();
  expect(saved.contacts.filter((c: {name: string}) => c.name === "Caroline")).toEqual([expect.objectContaining({ address })]);
});

it("reloads empty activity and reopens the current session's pending review", async () => {
  activity();
  await screen.findByText(/no activity yet/i);
  await propose();
  fireEvent.click(screen.getByRole("button", { name: "Refresh activity" }));
  const row = await screen.findByRole("button", { name: /ready for your confirmation/i });
  expect(row.querySelector("time")?.dateTime).toMatch(/^\d{4}-/);
  fireEvent.click(row);
  fireEvent.click(await screen.findByRole("button", { name: "Open review" }));
  expect(await screen.findByText("Send 5 USD to Bob?")).toBeTruthy();
  expect(screen.queryByRole("dialog")).toBeNull();
});

it("shows an older session's pending request with no unusable review button", async () => {
  await propose({ "x-arcie-session": "old-session" });
  activity();
  fireEvent.click(await screen.findByRole("button", { name: /ready for your confirmation/i }));
  expect(await screen.findByText(/another session/i)).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Open review" })).toBeNull();
});

it("reads the latest status from a historical event and reopens its failed receipt", async () => {
  const id = await propose();
  backend.kit.failNext("INSUFFICIENT_BALANCE");
  await backend.call("POST", `/intents/${id}/confirm`, {}, headers);
  activity();
  fireEvent.click(await screen.findByRole("button", { name: /ready for your confirmation/i }));
  expect(await screen.findByText("Failed", { exact: true })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "View receipt" }));
  expect(await screen.findByText(`failed receipt ${id}`)).toBeTruthy();
});

it("refreshes a processing request to reveal its settled receipt", async () => {
  const result = await backend.call("POST", "/intents", { kind: "swap", params: { tokenIn: "USDC", tokenOut: "EURC", amountIn: "5" } }, headers);
  const id = (await result.json()).island.intentId;
  backend.kit.setPendingNext();
  await backend.call("POST", `/intents/${id}/confirm`, {}, headers);
  activity();
  fireEvent.click(await screen.findByRole("button", { name: /still processing/i }));
  await screen.findByText("Processing", { exact: true });
  const hash = (await backend.harness.intents.get(id))!.txHash!;
  expect(screen.getByText(hash)).toBeTruthy();
  backend.kit.settle(hash);
  const { reconcileIntent } = await import("../../server/src/reconcile");
  await backend.harness.intents.patch(id, { reconcileCheckedAt: null });
  await reconcileIntent({ db: backend.db, kit: backend.kit, events: backend.events }, id);
  await waitFor(() => expect(screen.getByRole("button", { name: "View receipt" })).toBeTruthy(), { timeout: 8_000 });
}, 12_000);

it("shows the new account's empty address book after a failed load", async () => {
  const user = { "x-arcie-user": "new-account" };
  await backend.call("POST", "/auth/session", {}, user);
  vi.mocked(fetch).mockRejectedValueOnce(new Error("Contacts are unavailable."))
    .mockImplementation(async (path, init) => backend.app.request(String(path), { ...init, headers: user }));
  render(<ContactsSheet onClose={() => {}} />);
  expect(screen.getByRole("status").textContent).toMatch(/loading contacts/i);
  fireEvent.click(await screen.findByRole("button", { name: "Retry contacts" }));
  expect(await screen.findByText("No contacts yet.")).toBeTruthy();
  expect(screen.queryByText("Bob")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Add contact" }));
  expect(screen.getByLabelText("Name")).toBeTruthy();
});

it("displays checkout updates without a transaction link and excludes another account's activity", async () => {
  await backend.call("POST", "/onramp/events", { type: "submitted" }, headers);
  await backend.call("POST", "/onramp/events", { type: "failed" }, { "x-arcie-user": "other-account" });
  activity();
  expect(await screen.findByText("Add-money request submitted.")).toBeTruthy();
  expect(screen.queryByRole("button", { name: /submitted/i })).toBeNull();
  expect(screen.queryByText("Payment failed")).toBeNull();
});

it("can retry a failed status lookup and cannot reopen an expired proposal", async () => {
  const id = await propose();
  await backend.harness.intents.patch(id, { expiresAt: new Date(0).toISOString() });
  activity();
  const item = await screen.findByRole("button", { name: /ready for your confirmation/i });
  vi.mocked(fetch).mockRejectedValueOnce(new Error("Status temporarily unavailable."));
  fireEvent.click(item);
  await screen.findByText("Status temporarily unavailable.");
  fireEvent.click(screen.getByRole("button", { name: "Retry transaction details" }));
  expect(await screen.findByText("Expired", { exact: true })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Open review" })).toBeNull();
});
