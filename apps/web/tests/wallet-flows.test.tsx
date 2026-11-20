// @vitest-environment node
import { islandStream } from "./server-dom";
import { act, waitFor, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { App } from "../src/App";
import { testApp } from "../../server/src/testkit";

let backend: Awaited<ReturnType<typeof testApp>>;
let session = "";
const transcript: unknown[][] = [];

const button = (name: string | RegExp) => screen.findByRole("button", { name });
const click = async (name: string | RegExp) => fireEvent.click(await button(name));
beforeEach(async () => {
  transcript.length = 0;
  backend = await testApp({ agent: async function* (ctx, messages) {
    transcript.push(messages);
    if (messages.at(-1)?.content === "Send five") {
      yield (await backend.harness.propose(ctx, "send", { to: "Bob", amount: "5" })).summary;
    } else yield "Your wallet is ready.";
  } });
  vi.stubGlobal("EventSource", islandStream(backend.events, id => { session = id; }));
  vi.stubGlobal("fetch", (path: string, init: RequestInit) => backend.app.request(path, init));
  localStorage.clear();
  render(<App />);
  await click("Enter demo wallet");
  await button("Send");
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it("opens every wallet entry point after onboarding and signs out", async () => {
  for (const label of ["Add money", "Swap", "Account", "Contacts", "Activity", "Message Arcie", "Receive", "Talk to Arcie"]) {
    expect(await button(label)).toBeTruthy();
  }
  await click("Sign out");
  expect(await button("Enter demo wallet")).toBeTruthy();
});

it("puts voice first and opens contacts and activity from the balance card", async () => {
  const wallet = screen.getByRole("region", { name: "Wallet balance" });
  const voice = await button("Talk to Arcie");
  expect(voice.compareDocumentPosition(wallet) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  const shortcuts = within(wallet).getByRole("group", { name: "Wallet shortcuts" });
  for (const label of ["Contacts", "Activity"]) {
    const shortcut = within(shortcuts).getByRole("button", { name: label });
    expect(shortcut.textContent).toBe("");
    fireEvent.click(shortcut);
    const dialog = await screen.findByRole("dialog", { name: label });
    fireEvent.click(within(dialog).getByRole("button", { name: "Close" }));
  }
  const actions = within(wallet).getByRole("group", { name: "Money actions" });
  expect(within(actions).getAllByRole("button").map(b => b.textContent)).toEqual(["Add money", "Send", "Receive", "Swap"]);
});

it("continues an ambiguous send with the selected contact and waits for explicit confirmation", async () => {
  await click("Send");
  fireEvent.change(await screen.findByRole("textbox", { name: "Amount" }), { target: { value: "5" } });
  fireEvent.change(screen.getByRole("textbox", { name: "To" }), { target: { value: "ali" } });
  await click("Review");
  const choices = await screen.findByRole("dialog", {name: "Quick question"});
  fireEvent.click(await within(choices).findByRole("button", {name:/Alice Smith/}));
  await button("Confirm");
  expect(backend.kit.calls).toEqual([]);
  await click("Confirm");
  expect(await screen.findByRole("link", { name: "View on explorer" })).toBeTruthy();
  expect(backend.kit.calls).toEqual([{ method: "send", params: { to: "0x2222222222222222222222222222222222222222", amount: "5", token: "USDC" } }]);
});

it("keeps typed conversation history across closing and handles a tool card via the live session", async () => {
  await click("Message Arcie");
  const type = async (message: string) => {
    fireEvent.change(await screen.findByRole("textbox", { name: "Message" }), { target: { value: message } });
    await click("Send message");
  };
  await type("Hello");
  await screen.findByText("Your wallet is ready.");
  await click("Close chat");
  await click("Message Arcie");
  await type("Send five");
  await click("Cancel");
  await waitFor(async () => {
    const { items } = await (await backend.call("GET", "/activity")).json();
    expect(items.map((i: {type: string}) => i.type)).toContain("intent.cancelled");
  });
  expect(transcript[1]).toEqual([
    {role:"user", content:"Hello"}, {role:"assistant", content:"Your wallet is ready."}, {role:"user", content:"Send five"}
  ]);
  expect(backend.kit.calls).toEqual([]);
});

it("presents the new quote for a second approval when a swap moves beyond its limit", async () => {
  const h = { "x-arcie-session": session };
  const response = await act(async () => backend.call("POST", "/intents", {kind:"swap", params:{tokenIn:"USDC", tokenOut:"EURC", amountIn:"5"}}, h));
  const { island } = await response.json();
  await backend.harness.intents.patch(island.intentId, { quoteAt: new Date(Date.now()-60_000).toISOString() });
  backend.kit.setSwapRate("USDC", "EURC", 0.7);
  await click("Confirm");
  const review = await screen.findByRole("dialog", {name:"Please confirm"});
  expect(await within(review).findByText("3.5 EUR", {exact:false, selector:"dd"})).toBeTruthy();
  expect(backend.kit.calls).toEqual([]);
  await click("Confirm");
  await screen.findByRole("link", {name:"View on explorer"});
  expect(backend.kit.calls.map(x => x.method)).toEqual(["swap"]);
});

it("opens a receipt follow-up in text chat when voice is disconnected", async () => {
  await act(async () => backend.events.publish(session, {
    kind: "receipt", intentId: "finished", status: "succeeded", rows: [], elapsedMs: 15,
    nextStep: { label: "Check my earnings", utterance: "how are my earnings" },
  }));
  await click("Check my earnings");
  expect(await screen.findByRole("textbox", { name: "Message" })).toHaveProperty("value", "how are my earnings");
  await click("Send message");
  expect(await screen.findByText("Your wallet is ready.")).toBeTruthy();
});

it("renews the event and voice session when a sleeping wallet wakes after expiry", async () => {
  const old = session;
  vi.useFakeTimers({ toFake: ["Date"] });
  try {
    vi.setSystemTime(Date.now() + 3 * 3_600_000);
    await act(async () => document.dispatchEvent(new Event("visibilitychange")));
    await waitFor(() => expect(session).not.toBe(old));
    const current = await backend.call("GET", "/me", undefined, { "x-arcie-session": session });
    expect((await current.json()).user.id).toBe("demo");
  } finally {
    vi.useRealTimers();
  }
});

it.each([
  ["earn_deposit", "Depositing to savings…"],
  ["earn_withdraw", "Withdrawing from savings…"],
] as const)("uses the action on a %s review to label processing", async (action, expected) => {
  const intentId = "savings-in-progress";
  const island = {
    kind: "confirm" as const, action, intentId, title: "Move $5?", chips: ["Savings"],
    rows: [{ label: "Amount", value: "$5.00" }], adjustments: [], risks: [], disclosure: [],
    buttons: { confirm: "Move money", cancel: "Keep money" },
    expiresAt: new Date(Date.now() + 120_000).toISOString(), spokenPrompt: "Move five dollars?",
  };
  const original = globalThis.fetch;
  vi.stubGlobal("fetch", (path: string, init: RequestInit) =>
    path === `/intents/${intentId}/confirm`
      ? Promise.resolve(Response.json({ status: "executing" }))
      : original(path, init)
  );
  await act(async () => backend.events.publish(session, island));
  await click("Confirm");
  expect(await screen.findByText(expected)).toBeTruthy();
});
