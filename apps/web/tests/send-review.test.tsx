// @vitest-environment node
import "./server-dom";
import type { ConfirmIsland } from "@arcie/core";
import { ConversationProvider } from "@elevenlabs/react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useEffect } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DEMO_WALLET, testApp } from "../../server/src/testkit";
import { ActionSheet } from "../src/components/ActionSheet";
import { SendSheet } from "../src/components/SendSheet";
import { setSessionId } from "../src/lib/api";
import { IslandsProvider, useIslands } from "../src/lib/islands";

let backend: Awaited<ReturnType<typeof testApp>>;
const session = "send-review-test";
const alice = "0x1111111111111111111111111111111111111111";
class OfflineStream extends EventTarget { close() {} }

beforeEach(async () => {
  backend = await testApp();
  setSessionId(session);
  vi.stubGlobal("EventSource", OfflineStream);
  vi.stubGlobal("fetch", vi.fn((path: string, init: RequestInit) => backend.app.request(path, init)));
});
afterEach(() => { cleanup(); setSessionId(null); vi.unstubAllGlobals(); });

async function propose(to: string, amount: string): Promise<ConfirmIsland> {
  const response = await backend.call("POST", "/intents", { kind: "send", params: { amount, token: "USDC", to } }, { "x-arcie-session": session });
  expect(response.status).toBe(200);
  return (await response.json()).island;
}
function Review({ island }: { island: ConfirmIsland }) {
  const { push } = useIslands();
  useEffect(() => { push(island); }, [island, push]);
  return <ActionSheet />;
}
function showReview(island: ConfirmIsland) {
  render(<IslandsProvider sessionId={session}><ConversationProvider><Review island={island} /></ConversationProvider></IslandsProvider>);
}

it("shows the exact send title, destination and fee once and still requires approval", async () => {
  const card = await propose("demo:alice", "1");
  showReview(card);
  const panel = within(await screen.findByRole("dialog", { name: "Please confirm" }));
  expect(panel.getByRole("heading", { name: "Send 1 USDC to Alice" })).toBeTruthy();
  expect(panel.getByText(alice)).toBeTruthy();
  expect(panel.getByText("Network fee")).toBeTruthy();
  expect(panel.queryByText("Please confirm", { selector: "p" })).toBeNull();
  for (const hidden of ["Arc", ...card.risks, card.buttons.cancel, card.buttons.confirm]) expect(panel.queryByText(hidden)).toBeNull();
  expect(panel.queryByText(/You're sending|Expires in/)).toBeNull();
  expect(backend.harness.intents.listForUser("demo", 1)[0]?.status).toBe("awaiting_confirmation");
  fireEvent.click(panel.getByRole("button", { name: "Cancel" }));
  await waitFor(() => expect(backend.harness.intents.listForUser("demo", 1)[0]?.status).toBe("cancelled"));
  expect(backend.kit.calls).toEqual([]);
});

it("keeps fee adjustments, recipient-specific risks and the original wording of an expired historical review", async () => {
  backend.kit.setBalance(DEMO_WALLET, "USDC", "3");
  const card = await propose("0x4444444444444444444444444444444444444444", "all");
  const { send: _metadata, action: _action, ...historical } = card;
  showReview({ ...historical, expiresAt: new Date(Date.now() - 1000).toISOString() });
  expect(await screen.findByRole("heading", { name: card.title })).toBeTruthy();
  expect(screen.getByText(card.adjustments[0]!)).toBeTruthy();
  expect(screen.getByText("This is a new recipient.")).toBeTruthy();
  expect(screen.getByText(/This card expired/)).toBeTruthy();
  expect(screen.getByRole("button", { name: "Confirm" })).toHaveProperty("disabled", true);
  expect(screen.getByRole("button", { name: "Cancel" })).toHaveProperty("disabled", false);
  expect(backend.kit.calls).toEqual([]);
});

it("keeps a manually edited amount when a previous Send all quote finishes", async () => {
  const gate = Promise.withResolvers<void>();
  vi.mocked(fetch).mockImplementation(async (path, init) => {
    if (String(path).startsWith("/quotes/send-max")) await gate.promise;
    return backend.app.request(String(path), init);
  });
  render(<IslandsProvider sessionId={session}><SendSheet open onOpenChange={() => {}} /></IslandsProvider>);
  fireEvent.change(screen.getByLabelText("To"), { target: { value: "Bob" } });
  fireEvent.click(screen.getByRole("button", { name: "Send all" }));
  expect(screen.getByRole("button", { name: "Calculating…" })).toHaveProperty("disabled", true);
  await waitFor(() => expect(vi.mocked(fetch).mock.calls.some(([path]) => String(path).startsWith("/quotes/send-max"))).toBe(true));
  fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "2" } });
  await act(async () => { gate.resolve(); });
  expect(screen.getByLabelText("Amount")).toHaveProperty("value", "2");
  expect(screen.getByRole("button", { name: "Send all" }).getAttribute("aria-pressed")).toBe("false");
  expect(backend.kit.calls).toEqual([]);
});

it("fills the amount before a recipient is chosen, then automatically reserves their rounded fee and reviews the selected contact", async () => {
  backend.kit.setBalance(DEMO_WALLET, "USDC", "3.000001");
  backend.kit.estimateSend = async () => ({ fee: { label: "Network fee", amount: "0.0100001", token: "USDC" } });
  render(<IslandsProvider sessionId={session}><ConversationProvider><SendSheet open onOpenChange={() => {}} /><ActionSheet /></ConversationProvider></IslandsProvider>);
  const amount = screen.getByLabelText("Amount");
  fireEvent.click(screen.getByRole("button", { name: "Send all" }));
  await waitFor(() => expect(amount).toHaveProperty("value", "3.000001"));
  expect(screen.getByText(/before the network fee/i)).toBeTruthy();
  expect(screen.getByRole("button", { name: "Review" })).toHaveProperty("disabled", true);
  fireEvent.click(screen.getByRole("button", { name: "Contacts" }));
  const picker = within(await screen.findByRole("dialog", { name: "Choose contact" }));
  fireEvent.click(await picker.findByRole("button", { name: /^Alice 0x1111/ }));
  await waitFor(() => expect(screen.getByLabelText("Amount")).toHaveProperty("value", "2.99"));
  expect(screen.getByRole("button", { name: "Send all" }).getAttribute("aria-pressed")).toBe("true");
  fireEvent.click(screen.getByRole("button", { name: "Review" }));
  expect(await screen.findByRole("heading", { name: "Send 2.99 USDC to Alice" })).toBeTruthy();
  expect(backend.kit.calls).toEqual([]);
});

it("clears the initial maximum for an ambiguous name, blocks review, and recovers when a valid recipient is entered", async () => {
  render(<IslandsProvider sessionId={session}><SendSheet open onOpenChange={() => {}} /></IslandsProvider>);
  fireEvent.click(screen.getByRole("button", { name: "Send all" }));
  await waitFor(() => expect(screen.getByLabelText("Amount")).toHaveProperty("value", "100"));
  fireEvent.change(screen.getByLabelText("To"), { target: { value: "Ali" } });
  expect(screen.getByLabelText("Amount")).toHaveProperty("value", "");
  expect((await screen.findByRole("alert")).textContent).toMatch(/exact contact/i);
  expect(screen.getByRole("button", { name: "Review" })).toHaveProperty("disabled", true);
  fireEvent.change(screen.getByLabelText("To"), { target: { value: "Bob" } });
  await waitFor(() => expect(screen.getByLabelText("Amount")).toHaveProperty("value", "99.99"));
  expect(screen.getByRole("button", { name: "Review" })).toHaveProperty("disabled", false);
});
