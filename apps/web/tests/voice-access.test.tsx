import "./server-dom";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { Window as TestWindow } from "happy-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { type ReactNode } from "react";
import { App } from "../src/App";
import { testApp } from "../../server/src/testkit";

const voice = vi.hoisted(() => ({
  status: "connected", isMuted: false, isSpeaking: false,
  startSession: vi.fn(), endSession: vi.fn(), setMuted: vi.fn(),
  getInputVolume: () => 0, getOutputVolume: () => 0,
  sendUserMessage: vi.fn(), sendContextualUpdate: vi.fn(),
}));
vi.mock("@elevenlabs/react", () => ({
  ConversationProvider: ({children}: {children: ReactNode}) => children,
  useConversation: () => voice, useConversationControls: () => voice, useConversationStatus: () => voice,
}));

let backend: Awaited<ReturnType<typeof testApp>>;
let session: string;
const talk = "Talk to Arcie";
const button = (name: string) => screen.findByRole("button", {name});
const dialog = (name: string) => screen.findByRole("dialog", {name});
beforeEach(async () => {
  vi.clearAllMocks();
  backend = await testApp({elevenLabsAgentId:"fixture-agent"});
  class Stream extends EventTarget {
    private unsub: () => void;
    constructor(path: string) {
      super();
      session = new URL(path, "http://localhost").searchParams.get("sessionId")!;
      this.unsub = backend.bus.subscribe(session, (island) => this.dispatchEvent(new MessageEvent("island", {data: JSON.stringify(island)})));
    }
    close() { this.unsub(); }
  }
  vi.stubGlobal("EventSource", Stream);
  vi.stubGlobal("fetch", (path: string, init: RequestInit) => backend.app.request(path, init));
  vi.stubGlobal("navigator", {mediaDevices: {getUserMedia: async () => ({getTracks: () => []})}});
  const settings = (window as unknown as TestWindow).happyDOM.settings;
  settings.enableIframePageLoading = true;
  settings.fetch.interceptor = { beforeAsyncRequest: async ({ window }) => new window.Response("<html></html>", {headers: {"content-type": "text/html"}}) };
  localStorage.clear();
  render(<App />);
  fireEvent.click(await button("Enter demo wallet"));
  await button("Send");
});
afterEach(() => {
  cleanup();
  const settings = (window as unknown as TestWindow).happyDOM.settings;
  settings.enableIframePageLoading = false;
  settings.fetch.interceptor = null;
  vi.unstubAllGlobals();
});

it("opens voice above a drawer, keeps its fields mounted, and restores focus on Escape", async () => {
  expect(screen.getAllByRole("button", {name:talk})).toHaveLength(1);
  fireEvent.click(await button("Send"));
  const send = await dialog("Send");
  const amount = within(send).getByRole("textbox", {name:"Amount"});
  fireEvent.change(amount, {target:{value:"12.50"}});
  const mic = within(send).getByRole("button", {name:talk});
  mic.focus();
  fireEvent.click(mic);
  const panel = await dialog("Voice conversation");
  await waitFor(() => expect(voice.startSession).toHaveBeenCalledTimes(1));
  // A stale checkout echo from another tap must not dismiss the conversation.
  act(() => backend.bus.publish(session, {
    kind:"onramp", requestId:"old-request", token:"USDC", environment:"sandbox", destinationAddress:"0x123",
    sessionToken:"old-checkout", expiresAt:"2099-01-01T00:00:00Z", widgetUrl:"https://onramp-sandbox.arc.io/",
  }));
  expect(screen.getAllByRole("dialog")).toEqual([panel]);
  expect(document.contains(amount)).toBe(true);
  fireEvent.keyDown(within(panel).getByRole("button", {name:"Close voice"}), {key:"Escape", code:"Escape"});
  await dialog("Send");
  expect(within(send).getByRole("textbox", {name:"Amount"})).toBe(amount);
  expect(amount).toHaveProperty("value", "12.50");
  await waitFor(() => expect(document.activeElement).toBe(mic));
  expect(voice.endSession).toHaveBeenCalledTimes(1);
});

it("restores a chat draft and leaves only the chat microphone accessible", async () => {
  fireEvent.click(await button("Message Arcie"));
  const input = await screen.findByRole("textbox", {name: "Message"});
  fireEvent.change(input, {target:{value:"draft message"}});
  const mic = await button(talk);
  expect(mic.closest("header")).toBeTruthy();
  expect(screen.getAllByRole("button", {name:talk})).toHaveLength(1);
  fireEvent.click(mic);
  await dialog("Voice conversation");
  fireEvent.click(await button("Close voice"));
  await waitFor(() => expect(document.activeElement).toBe(mic));
  expect(input).toHaveProperty("value", "draft message");
});

it("returns to the same voice conversation after receiving, then restores the original send draft", async () => {
  fireEvent.click(await button("Send"));
  const send = await dialog("Send");
  const amount = within(send).getByRole("textbox", {name: "Amount"});
  fireEvent.change(amount, {target: {value:"12.50"}});
  const mic = within(send).getByRole("button", {name: talk});
  mic.focus();
  fireEvent.click(mic);
  await dialog("Voice conversation");

  await act(async () => backend.harness.runTool({ userId:"demo", sessionId:session, channel:"voice", userTurn:1, runId:"receive", now:() => new Date() }, "get_receive_info", {}));
  const receive = await dialog("Receive");
  expect(screen.getAllByRole("dialog")).toEqual([receive]);
  expect(within(receive).getByTitle("Wallet address QR code")).toBeTruthy();
  fireEvent.click(within(receive).getByRole("button", {name:"Close"}));
  const panel = await dialog("Voice conversation");
  expect(voice.startSession).toHaveBeenCalledTimes(1);
  expect(voice.endSession).not.toHaveBeenCalled();
  fireEvent.click(within(panel).getByRole("button", {name:"End conversation"}));
  expect(await dialog("Send")).toBe(send);
  await waitFor(() => expect(document.activeElement).toBe(mic));
  expect(amount).toHaveProperty("value", "12.50");
});

it("shows a new review above checkout without remounting the same secure session", async () => {
  fireEvent.click(await button(talk));
  await dialog("Voice conversation");
  const ctx = { userId:"demo", sessionId:session, channel:"voice" as const, userTurn:1, runId:"checkout", now:() => new Date() };
  await act(async () => backend.harness.runTool(ctx, "start_onramp", {amount:"10"}));
  const checkout = await dialog("Add money");
  const frame = await within(checkout).findByTitle("Circle secure deposit checkout");

  await act(async () => backend.harness.runTool({ ...ctx, userTurn:2, runId:"send" }, "propose_send", {to:"Bob", amount:"1"}));
  const panel = await dialog("Voice conversation");
  expect(screen.getAllByRole("dialog")).toEqual([panel]);
  expect(within(panel).getByRole("heading", {name:"Send 1 USDC to Bob"})).toBeTruthy();
  fireEvent.click(within(panel).getByRole("button", {name:"Cancel"}));
  await waitFor(() => expect(within(panel).queryByRole("region", {name:"Transaction review"})).toBeNull());
  expect(voice.startSession).toHaveBeenCalledTimes(1);
  expect(voice.endSession).not.toHaveBeenCalled();
  fireEvent.click(within(panel).getByRole("button", {name:"End conversation"}));
  expect(await within(await dialog("Add money")).findByTitle("Circle secure deposit checkout")).toBe(frame);
  expect(backend.kit.calls.map(x => x.method)).toEqual(["createOnrampSession"]);
});

it("keeps the active checkout in place when moving between receive and the voice conversation", async () => {
  fireEvent.click(await button(talk));
  await dialog("Voice conversation");
  const ctx = { userId:"demo", sessionId:session, channel:"voice" as const, userTurn:1, runId:"handoff", now:() => new Date() };
  await act(async () => backend.harness.runTool(ctx, "start_onramp", {}));
  const checkout = await dialog("Add money");
  const frame = await within(checkout).findByTitle("Circle secure deposit checkout");

  await act(async () => backend.harness.runTool({ ...ctx, userTurn:2, runId:"receive" }, "get_receive_info", {}));
  const receive = await dialog("Receive");
  expect(screen.getAllByRole("dialog")).toEqual([receive]);
  expect(frame.isConnected).toBe(true);
  fireEvent.click(within(receive).getByRole("button", {name:"Close"}));
  const panel = await dialog("Voice conversation");
  expect(screen.getAllByRole("dialog")).toEqual([panel]);
  fireEvent.click(within(panel).getByRole("button", {name:"End conversation"}));
  expect(await within(await dialog("Add money")).findByTitle("Circle secure deposit checkout")).toBe(frame);
  expect(voice.startSession).toHaveBeenCalledTimes(1);
  expect(voice.endSession).toHaveBeenCalledTimes(1);
});

it("does not interrupt voice when a checkout started by a tap arrives late", async () => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  vi.stubGlobal("fetch", async (path: string, init: RequestInit) => {
    if (path === "/onramp/sessions") await gate;
    return backend.app.request(path, init);
  });
  fireEvent.click(await button("Add money"));
  const checkout = await dialog("Add money");
  fireEvent.click(within(checkout).getByRole("button", {name:"Open checkout"}));
  expect(await within(checkout).findByText("Preparing your checkout…")).toBeTruthy();
  fireEvent.click(within(checkout).getByRole("button", {name:talk}));
  const panel = await dialog("Voice conversation");
  await waitFor(() => expect(voice.startSession).toHaveBeenCalledTimes(1));
  await act(async () => release());
  const frame = await screen.findByTitle("Circle secure deposit checkout");
  expect(screen.getAllByRole("dialog")).toEqual([panel]);
  fireEvent.click(within(panel).getByRole("button", {name:"End conversation"}));
  expect(await within(await dialog("Add money")).findByTitle("Circle secure deposit checkout")).toBe(frame);
});

it.each([
  {screen:"contacts", tool:"list_contacts", title:"Contacts", text:/Alice Smith/},
  {screen:"activity", tool:"get_activity", title:"Activity", text:/No activity yet/},
] as const)("shows $title on request and resumes voice when it closes", async ({screen: requested, tool, title, text}) => {
  fireEvent.click(await button(talk));
  const panel = await dialog("Voice conversation");
  const ctx = { userId:"demo", sessionId:session, channel:"voice" as const, userTurn:1, runId:requested, now:() => new Date() };
  await act(async () => backend.harness.runTool(ctx, tool, {}));
  expect(screen.getAllByRole("dialog")).toEqual([panel]);
  await act(async () => backend.harness.runTool({ ...ctx, userTurn:2 }, tool, {show:true}));
  const details = await dialog(title);
  expect(screen.getAllByRole("dialog")).toEqual([details]);
  expect(await within(details).findByText(text)).toBeTruthy();
  expect(within(details).getByRole("button", {name:"Return to voice"})).toBeTruthy();
  fireEvent.click(within(details).getByRole("button", {name:"Close"}));
  expect(screen.getAllByRole("dialog")).toEqual([await dialog("Voice conversation")]);
  expect(voice.startSession).toHaveBeenCalledTimes(1);
  expect(voice.endSession).not.toHaveBeenCalled();
});

it.each([
  {tool:"propose_swap", args:{tokenIn:"USDC", tokenOut:"EURC", amountIn:"5"}, heading:/Swap 5 USD for about .* EUR/, method:"swap"},
  {tool:"propose_earn_deposit", args:{amount:"5"}, heading:"Add 5 USD to savings?", method:"deposit"},
  {tool:"propose_earn_withdraw", args:{amount:"5"}, heading:"Withdraw 5 USD from savings?", method:"withdraw"},
] as const)("shares the voice review, approval and receipt workflow for $tool", async ({tool, args, heading, method}) => {
  if (method === "withdraw") {
    const seed = { userId:"demo", sessionId:"seed-savings", channel:"screen" as const, userTurn:1, runId:"seed", now:() => new Date() };
    await backend.harness.runTool(seed, "propose_earn_deposit", {amount:"10"});
    await backend.harness.confirm(seed, undefined, "screen");
  }
  fireEvent.click(await button(talk));
  const panel = await dialog("Voice conversation");
  const ctx = { userId:"demo", sessionId:session, channel:"voice" as const, userTurn:1, runId:"propose", now:() => new Date() };
  await act(async () => backend.harness.runTool(ctx, tool, args));
  const review = within(await within(panel).findByRole("region", {name:"Transaction review"}));
  expect(review.getByRole("heading", {name:heading})).toBeTruthy();
  expect(backend.kit.calls.filter(call => call.method === method)).toHaveLength(0);
  await act(async () => backend.harness.runTool({ ...ctx, userTurn:2, runId:"confirm" }, "confirm_intent", {}));
  expect(await within(panel).findByText("Transaction complete.")).toBeTruthy();
  expect(backend.kit.calls.filter(call => call.method === method)).toHaveLength(1);
  expect(screen.getAllByRole("dialog")).toEqual([panel]);
});

it("keeps a receipt opened from voice activity visible until the user is done with it", async () => {
  const ctx = { userId:"demo", sessionId:"earlier-send", channel:"screen" as const, userTurn:1, runId:"send", now:() => new Date() };
  await backend.harness.runTool(ctx, "propose_send", {to:"Bob", amount:"2"});
  await backend.harness.confirm(ctx, undefined, "screen");

  fireEvent.click(await button(talk));
  await dialog("Voice conversation");
  act(() => backend.bus.publish(session, {kind:"open_screen", screen:"activity", requestId:"voice-receipt"}));
  const activity = await dialog("Activity");
  fireEvent.click(await within(activity).findByRole("button", {name:/Completed/}));
  const details = await dialog("Transaction details");
  fireEvent.click(await within(details).findByRole("button", {name:"View receipt"}));
  expect(await within(details).findByRole("link", {name:"View on explorer"})).toBeTruthy();
  fireEvent.click(within(details).getByRole("button", {name:"Done"}));
  expect(within(details).getByText("Current status")).toBeTruthy();
  fireEvent.click(within(details).getByRole("button", {name:"Close"}));
  expect(screen.getAllByRole("dialog")).toEqual([await dialog("Voice conversation")]);
  expect(voice.endSession).not.toHaveBeenCalled();
});

it("shows a new proposal inside the same voice dialog and returns to listening when cancelled", async () => {
  fireEvent.click(await button(talk));
  const panel = await dialog("Voice conversation");
  await waitFor(() => expect(voice.startSession).toHaveBeenCalledTimes(1));
  await act(async () => {
    await backend.call("POST", "/intents", {kind:"send",params:{to:"Bob",token:"USDC",amount:"2"}}, {"x-arcie-session":session});
  });
  const review = await within(panel).findByRole("region", {name:"Transaction review"});
  expect(screen.getAllByRole("dialog")).toEqual([panel]);
  expect(within(review).getByRole("heading", {name:"Send 2 USDC to Bob"})).toBeTruthy();
  expect(backend.kit.calls).toEqual([]);
  act(() => backend.bus.publish(session, { kind: "receipt", intentId: "earlier-action", status: "succeeded", rows: [], elapsedMs: 20 }));
  fireEvent.click(within(review).getByRole("button", {name:"Cancel"}));
  await waitFor(() => expect(within(panel).queryByRole("region", {name:"Transaction review"})).toBeNull());
  expect(within(panel).queryByText("Transaction complete.")).toBeNull();
  expect(screen.getAllByRole("dialog")).toEqual([panel]);
  expect(backend.kit.calls).toEqual([]);
  expect(voice.sendContextualUpdate).toHaveBeenCalledWith(expect.stringContaining("cancelled intent"));
  expect(voice.endSession).not.toHaveBeenCalled();
  fireEvent.click(await button("End conversation"));
  await button(talk);
  expect(voice.startSession).toHaveBeenCalledTimes(1);
  expect(voice.endSession).toHaveBeenCalledTimes(1);
});

it("shows an unverified voice submission without suggesting another attempt", async () => {
  fireEvent.click(await button(talk));
  const panel = await dialog("Voice conversation");
  const proposed = await act(async () => backend.call("POST", "/intents", {kind:"send",params:{to:"Bob",amount:"5"}}, {"x-arcie-session":session}));
  const { island } = await proposed.json();
  backend.kit.failNext("RPC_UNAVAILABLE");
  await act(async () => {
    await backend.harness.confirm({ userId:"demo", sessionId:session, channel:"voice", userTurn:2, runId:"unverified", now:() => new Date() }, island.intentId, "voice");
  });
  const review = within(await within(panel).findByRole("region", {name:"Transaction review"}));
  expect(review.getByText("Status unverified")).toBeTruthy();
  expect(review.getByText(/check your activity before trying again/i)).toBeTruthy();
  expect(review.queryByRole("button", {name:"Confirm"})).toBeNull();
  fireEvent.click(review.getByRole("button", {name:"View later in Activity"}));
  await waitFor(() => expect(within(panel).queryByRole("region", {name:"Transaction review"})).toBeNull());
  expect(voice.endSession).not.toHaveBeenCalled();
});

it("dismisses an ambiguous contact choice inside voice without moving money", async () => {
  fireEvent.click(await button(talk));
  const panel = await dialog("Voice conversation");
  await act(async () => backend.call("POST", "/intents", {kind:"send",params:{to:"Ali",amount:"5"}}, {"x-arcie-session":session}));
  const choice = within(await within(panel).findByRole("region", {name:"Choose an option"}));
  expect(choice.getByRole("button", {name:/Alice Smith/})).toBeTruthy();
  fireEvent.click(choice.getByRole("button", {name:"Cancel"}));
  await waitFor(() => expect(within(panel).queryByRole("region", {name:"Choose an option"})).toBeNull());
  expect(backend.kit.calls).toEqual([]);
  expect(voice.endSession).not.toHaveBeenCalled();
});

it.each(["checkout", "review"] as const)("shows both Alices in voice when a %s is already open", async (previous) => {
  fireEvent.click(await button(talk));
  const panel = await dialog("Voice conversation");
  const ctx = { userId: "demo", sessionId: session, channel: "voice" as const, userTurn: 1, runId: "previous", now: () => new Date() };
  const before = await act(async () => previous === "checkout"
    ? backend.harness.runTool(ctx, "start_onramp", {})
    : backend.harness.runTool(ctx, "propose_send", { to: "Bob", amount: "2" }));
  if (previous === "checkout") await dialog("Add money");
  else await within(panel).findByRole("region", { name: "Transaction review" });

  await act(async () => backend.harness.runTool({ ...ctx, userTurn: 2, runId: "alice" }, "propose_send", { to: "Alice", amount: "1" }));
  const livePanel = await dialog("Voice conversation");
  const choice = within(await within(livePanel).findByRole("region", { name: "Choose an option" }));
  expect(choice.getByRole("button", { name: /^Alice 0x/ })).toBeTruthy();
  if (before.island?.kind === "confirm") {
    expect(backend.harness.intents.get(before.island.intentId)?.status).toBe("cancelled");
  }
  fireEvent.click(choice.getByRole("button", { name: /Alice Smith/ }));
  expect(await within(livePanel).findByRole("heading", { name: "Send 1 USDC to Alice Smith" })).toBeTruthy();
  expect(backend.kit.calls.filter((call) => call.method === "send")).toEqual([]);
  expect(voice.startSession).toHaveBeenCalledTimes(1);
  expect(voice.endSession).not.toHaveBeenCalled();
});

it.each(["voice", "tap"] as const)("shows processing beneath the orb after a %s confirmation and closes the card on settlement", async (channel) => {
  fireEvent.click(await button(talk));
  const panel = await dialog("Voice conversation");
  await waitFor(() => expect(voice.startSession).toHaveBeenCalledTimes(1));
  const headers = { "x-arcie-session": session };
  const proposed = await act(async () => backend.call("POST", "/intents", {kind:"send",params:{to:"Bob",amount:"5"}}, headers));
  const { island } = await proposed.json();
  const review = await within(panel).findByRole("region", {name:"Transaction review"});
  const send = backend.kit.send.bind(backend.kit);
  let release!: () => void;
  backend.kit.send = async (...args) => {
    await new Promise<void>((resolve) => { release = resolve; });
    return send(...args);
  };
  if (channel === "tap") {
    fireEvent.click(within(review).getByRole("button", {name:"Confirm"}));
  } else {
    await act(async () => {
      void backend.harness.confirm({ userId:"demo", sessionId:session, channel:"voice", userTurn:2, runId:"confirm-by-voice", now:() => new Date() }, island.intentId, "voice");
    });
  }
  expect(await within(review).findByText("Sending…")).toBeTruthy();
  expect(within(review).queryByRole("button", {name:"Confirm"})).toBeNull();
  await waitFor(() => expect(release).toBeTypeOf("function"));
  await act(async () => release());
  expect(await within(panel).findByText("Transaction complete.")).toBeTruthy();
  await waitFor(() => expect(within(panel).queryByRole("region", {name:"Transaction review"})).toBeNull());
  expect(screen.getAllByRole("dialog")).toEqual([panel]);
  expect(backend.kit.calls).toHaveLength(1);
  expect(voice.endSession).not.toHaveBeenCalled();
  fireEvent.click(within(panel).getByRole("button", {name:"End conversation"}));
  await button(talk);
  expect(screen.queryByRole("dialog", {name:"Receipt"})).toBeNull();
  if (channel === "tap") {
    fireEvent.click(await button("Activity"));
    const activity = await dialog("Activity");
    fireEvent.click(await within(activity).findByRole("button", {name:/Completed/}));
    fireEvent.click(await button("View receipt"));
    expect(await within(await dialog("Receipt")).findByRole("link", {name:"View on explorer"})).toBeTruthy();
  }
});
