import "./server-dom";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IslandsProvider } from "../src/lib/islands";
import { PrivyLogin } from "../src/screens/Login";
import { VoiceScreen } from "../src/screens/Voice";
import { App } from "../src/App";
import { testApp } from "../../server/src/testkit";

const privy = vi.hoisted(() => ({
  sendCode: vi.fn(), loginWithCode: vi.fn(), initOAuth: vi.fn(), login: vi.fn(),
  state: { status: "initial" }, loading: false,
  ready: true, authenticated: false, getAccessToken: vi.fn(), logout: vi.fn(),
}));
vi.mock("@privy-io/react-auth", () => ({
  PrivyProvider: ({ children }: { children: ReactNode }) => children,
  useLoginWithEmail: () => privy, useLoginWithOAuth: () => privy, usePrivy: () => privy,
}));
const voice = vi.hoisted(() => ({
  status: "connected", isMuted: false, isSpeaking: false,
  setMuted: vi.fn(), startSession: vi.fn(), endSession: vi.fn(),
  getInputVolume: () => 0, getOutputVolume: () => 0,
  events: {} as {
    onMessage: (m: {source: string; message: string}) => void;
    onError: (s: string) => void;
    onDisconnect: (details: {reason: "agent"} | {reason: "error"; message: string}) => void;
  },
}));
vi.mock("@elevenlabs/react", () => ({
  ConversationProvider: ({ children }: { children: ReactNode }) => children,
  useConversationStatus: () => ({ status: "disconnected" }),
  useConversationControls: () => ({}),
  useConversation: (callbacks: typeof voice.events) => { voice.events = callbacks; return voice; },
}));
class LocalStream extends EventTarget {
  static current: LocalStream;
  constructor() { super(); LocalStream.current = this; }
  close() {}
}
const stop = vi.fn();
const getMicrophone = vi.fn();
beforeEach(() => {
  vi.resetAllMocks();
  privy.state.status = "initial";
  privy.loading = false;
  privy.authenticated = false;
  voice.status = "connected";
  voice.isMuted = false;
  privy.sendCode.mockResolvedValue(undefined);
  privy.loginWithCode.mockResolvedValue(undefined);
  privy.initOAuth.mockResolvedValue(undefined);
  getMicrophone.mockResolvedValue({ getTracks: () => [{stop}] });
  vi.stubGlobal("EventSource", LocalStream);
  vi.stubGlobal("navigator", { mediaDevices: { getUserMedia: getMicrophone } });
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({conversationId:"conversation-test"})));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("Privy sign-in options", () => {
  it("opens an authenticated wallet after Privy login and returns to sign-in after logout", async () => {
    const backend = await testApp({authMode: "privy", privyAppId: "fixture-app"});
    vi.stubGlobal("fetch", vi.fn((path: string, init: RequestInit) => backend.app.request(path, init)));
    privy.getAccessToken.mockResolvedValue("tok-test-user");
    const app = render(<App />);
    privy.initOAuth.mockImplementation(async () => { privy.authenticated = true; app.rerender(<App />); });
    privy.logout.mockImplementation(async () => { privy.authenticated = false; app.rerender(<App />); });
    fireEvent.click(await screen.findByRole("button", { name: "Continue with Google" }));
    await screen.findByRole("button", {name: "Send"});
    const authenticatedPaths = vi.mocked(fetch).mock.calls.filter(([, init]) => new Headers(init?.headers).has("authorization")).map(([path]) => path);
    expect(authenticatedPaths).toEqual(expect.arrayContaining(["/auth/session", "/voice/session", "/balances"]));
    fireEvent.click(screen.getByRole("button", {name: "Sign out"}));
    expect(await screen.findByRole("button", {name: "Continue with Google"})).toBeTruthy();
  });
  it.each(["google", "apple"])("passes the selected %s identity provider and surfaces its error", async (provider) => {
    privy.initOAuth.mockRejectedValueOnce(new Error("Sign-in was interrupted."));
    render(<PrivyLogin />);
    fireEvent.click(screen.getByRole("button", { name: new RegExp("Continue with " + provider, "i") }));
    expect(privy.initOAuth).toHaveBeenCalledWith({ provider });
    expect(await screen.findByRole("alert")).toHaveProperty("textContent", "Sign-in was interrupted.");
  });
  it("opens Privy's wallet sign-in under More options", () => {
    render(<PrivyLogin />);
    fireEvent.click(screen.getByRole("button", { name: "More options" }));
    expect(privy.login).toHaveBeenCalledWith({ loginMethods: ["wallet"] });
  });
  it("sends an email code, keeps the code field after a rejection, and accepts a corrected six-digit code", async () => {
    render(<PrivyLogin />);
    fireEvent.click(screen.getByRole("button", { name: /continue with email/i }));
    fireEvent.change(screen.getByRole("textbox", {name: /email/i}), {target: {value: "person@example.test"}});
    fireEvent.click(screen.getByRole("button", {name: "Send me a code"}));
    const code = await screen.findByRole("textbox", {name: /code/i});
    expect(privy.sendCode).toHaveBeenCalledWith({ email: "person@example.test" });
    fireEvent.change(code, {target: {value: "23abc"}});
    const submit = screen.getByRole<HTMLButtonElement>("button", {name: "Continue"});
    expect(submit.disabled).toBe(true);
    fireEvent.change(code, {target: {value: "654321"}});
    privy.loginWithCode.mockImplementationOnce(async () => {
      privy.state.status = "error";
      throw new Error("Incorrect code.");
    });
    fireEvent.click(submit);
    expect(await screen.findByRole("alert")).toHaveProperty("textContent", "Incorrect code.");
    fireEvent.change(screen.getByRole("textbox", {name: /code/i}), {target: {value: "123456"}});
    fireEvent.click(screen.getByRole("button", {name: "Continue"}));
    await waitFor(() => expect(privy.loginWithCode.mock.calls).toEqual([[{code: "654321"}], [{code: "123456"}]]));
  });
});

function VoiceHost({agentId}: {agentId: string | null}) {
  const [open, setOpen] = useState(false);
  return <>
    <button onClick={() => setOpen(true)}>Talk</button>
    {open && <VoiceScreen agentId={agentId} sessionId="session-test" onClose={() => setOpen(false)} />}
  </>;
}
function publishStep(id: string) {
  const island = { kind: "steps", runId: id, elapsedMs: 100, steps: [{id, label: id + " step", status: "running"}] };
  act(() => LocalStream.current.dispatchEvent(new MessageEvent("island", {data: JSON.stringify(island)})));
}
function mountVoice(agentId: string | null = "test-agent") {
  render(<IslandsProvider sessionId="session-test"><VoiceHost agentId={agentId} /></IslandsProvider>);
  publishStep("old");
  fireEvent.click(screen.getByRole("button", {name:"Talk"}));
}

describe("voice conversation", () => {
  it("starts the session, frees the permission-check microphone, and wires mute, transcript, steps and end", async () => {
    mountVoice();
    await waitFor(() => expect(voice.startSession).toHaveBeenCalledWith({
      agentId: "test-agent", connectionType: "webrtc", customLlmExtraBody: {session_id: "session-test", arcie_conversation_id:"conversation-test"},
    }));
    expect(fetch).toHaveBeenCalledWith("/voice/conversation", expect.objectContaining({method:"POST"}));
    expect(getMicrophone).toHaveBeenCalledWith({audio:true});
    expect(stop).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", {name:"Mute"}));
    expect(voice.setMuted).toHaveBeenCalledWith(true);
    voice.isMuted = true;
    act(() => { voice.events.onMessage({source:"user", message:"My balance?"}); voice.events.onMessage({source:"ai", message:"Opening your balance."}); });
    expect(screen.getByText("“My balance?”")).toBeTruthy();
    expect(screen.getByText("Opening your balance.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", {name:"Unmute"}));
    expect(voice.setMuted).toHaveBeenLastCalledWith(false);
    expect(screen.queryByText("old step")).toBeNull();
    publishStep("current");
    expect(screen.getByText("current step")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", {name:"End conversation"}));
    expect(voice.endSession).toHaveBeenCalledTimes(1);
  });
  it("reports a denied microphone without opening a conversation", async () => {
    getMicrophone.mockRejectedValueOnce(new DOMException("Denied", "NotAllowedError"));
    mountVoice();
    expect(await screen.findByRole("alert")).toHaveProperty("textContent", expect.stringMatching(/microphone access/i));
    expect(voice.startSession).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });
  it("handles a browser without microphone support and can still close", async () => {
    vi.stubGlobal("navigator", {});
    mountVoice();
    expect(await screen.findByRole("alert")).toHaveProperty("textContent", expect.stringMatching(/browser.*microphone/i));
    fireEvent.click(screen.getByRole("button", {name:"Close voice"}));
    expect(voice.startSession).not.toHaveBeenCalled();
  });
  it("shows an SDK startup error after permission succeeds", async () => {
    voice.startSession.mockImplementationOnce(() => { throw new Error("Conversation service unavailable."); });
    mountVoice();
    expect(await screen.findByRole("alert")).toHaveProperty("textContent", "Conversation service unavailable.");
  });
  it("reports SDK connection failures through the voice error callback", async () => {
    mountVoice();
    await waitFor(() => expect(voice.startSession).toHaveBeenCalled());
    act(() => voice.events.onError("Voice service disconnected."));
    expect(screen.getByRole("alert")).toHaveProperty("textContent", "Voice service disconnected.");
  });
  it("shows that a conversation ended when the agent hangs up", async () => {
    mountVoice();
    await waitFor(() => expect(voice.startSession).toHaveBeenCalled());
    voice.status = "disconnected";
    act(() => voice.events.onDisconnect({reason:"agent"}));
    expect(screen.getByText("Conversation ended")).toBeTruthy();
    expect(screen.getByRole<HTMLButtonElement>("button", {name:"Mute"}).disabled).toBe(true);
  });
  it("skips microphone access when voice is unconfigured", async () => {
    mountVoice(null);
    expect(await screen.findByRole("alert")).toHaveProperty("textContent", expect.stringMatching(/voice.*configured|voice.*available|voice.*set up/i));
    expect(getMicrophone).not.toHaveBeenCalled();
  });
  it("releases a permission-check stream that arrives after the voice screen closes", async () => {
    let allow!: (stream: unknown) => void;
    getMicrophone.mockReturnValueOnce(new Promise((resolve) => { allow = resolve; }));
    mountVoice();
    await waitFor(() => expect(getMicrophone).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", {name:"Close voice"}));
    await act(async () => { allow({getTracks: () => [{stop}]}); });
    expect(stop).toHaveBeenCalledTimes(1);
    expect(voice.startSession).not.toHaveBeenCalled();
  });
  it("does not start the SDK when the conversation handshake finishes after closing voice", async () => {
    let respond!: (r: Response) => void;
    vi.mocked(fetch).mockReturnValueOnce(new Promise(resolve => { respond = resolve; }));
    mountVoice();
    await waitFor(() => expect(fetch).toHaveBeenCalledWith("/voice/conversation", expect.objectContaining({method:"POST"})));
    const signal = vi.mocked(fetch).mock.calls[0]?.[1]?.signal;
    fireEvent.click(screen.getByRole("button", {name:"Close voice"}));
    await act(async () => { respond(Response.json({conversationId:"late-conversation"})); });
    expect(signal?.aborted).toBe(true);
    expect(voice.startSession).not.toHaveBeenCalled();
  });
});
