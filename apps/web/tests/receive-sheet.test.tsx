import "./server-dom";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { testApp, DEMO_WALLET } from "../../server/src/testkit";
import { ReceiveSheet } from "../src/components/ReceiveSheet";
import { IslandsProvider } from "../src/lib/islands";
import { setSessionId } from "../src/lib/api";

let backend: Awaited<ReturnType<typeof testApp>>;
const session = "receive-test";
const copy = vi.fn();
const share = vi.fn();
beforeEach(async () => {
  backend = await testApp();
  setSessionId(session);
  vi.resetAllMocks();
  copy.mockResolvedValue(undefined);
  share.mockResolvedValue(undefined);
  vi.stubGlobal("navigator", { clipboard: {writeText: copy}, share });
  class Stream extends EventTarget {
    private unsubscribe = backend.bus.subscribe(session, (island) => this.dispatchEvent(new MessageEvent("island", {data: JSON.stringify(island)})));
    close() { this.unsubscribe(); }
  }
  vi.stubGlobal("EventSource", Stream);
  vi.stubGlobal("fetch", vi.fn((path: string, init: RequestInit) => backend.app.request(path, init)));
});
afterEach(() => { cleanup(); setSessionId(null); vi.unstubAllGlobals(); });
function Host() {
  const [open, setOpen] = useState(false);
  return <><button onClick={() => setOpen(true)}>Receive money</button><ReceiveSheet open={open} onOpenChange={setOpen} /></>;
}
function mount() { render(<IslandsProvider sessionId={session}><Host /></IslandsProvider>); }
async function open() {
  mount();
  fireEvent.click(screen.getByRole("button", {name:"Receive money"}));
  await screen.findByText(DEMO_WALLET.address);
}

it("shows the wallet address and QR, and copies or shares the actual address", async () => {
  await open();
  expect(screen.getByTitle("Wallet address QR code").closest("svg")).toBeTruthy();
  expect(screen.getAllByText(/Only send USD, EUR, BTC on Arc Testnet/).length).toBeGreaterThan(0);
  fireEvent.click(screen.getByRole("button", {name:"Copy"}));
  expect(await screen.findByRole("button", {name:"Copied"})).toBeTruthy();
  expect(copy).toHaveBeenCalledWith(DEMO_WALLET.address);
  fireEvent.click(screen.getByRole("button", {name:"Share"}));
  await waitFor(() => expect(share).toHaveBeenCalledWith({title: "My Arcie address", text: DEMO_WALLET.address}));
});
it.each(["denied", "missing"])("reports a %s clipboard without showing Copied", async (reason) => {
  if (reason === "denied") copy.mockRejectedValueOnce(new DOMException("Not allowed", "NotAllowedError"));
  else vi.stubGlobal("navigator", {});
  await open();
  fireEvent.click(screen.getByRole("button", {name:"Copy"}));
  expect(await screen.findByRole("alert")).toHaveProperty("textContent", expect.stringMatching(/copy/i));
  expect(screen.queryByRole("button", {name:"Copied"})).toBeNull();
  expect(screen.getByText(DEMO_WALLET.address)).toBeTruthy();
});
it("handles a share failure, a cancelled share, and clipboard fallback", async () => {
  await open();
  share.mockRejectedValueOnce(new Error("Sharing service unavailable."));
  fireEvent.click(screen.getByRole("button", {name:"Share"}));
  expect(await screen.findByRole("alert")).toHaveProperty("textContent", expect.stringMatching(/shar/i));
  share.mockRejectedValueOnce(new DOMException("Cancelled", "AbortError"));
  fireEvent.click(screen.getByRole("button", {name:"Share"}));
  await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
  vi.stubGlobal("navigator", {clipboard:{writeText:copy}});
  fireEvent.click(screen.getByRole("button", {name:"Share"}));
  expect(await screen.findByRole("button", {name:"Copied"})).toBeTruthy();
  expect(copy).toHaveBeenCalledWith(DEMO_WALLET.address);
});
it("retries an address lookup and opens a new receive address from voice after dismissal", async () => {
  mount();
  vi.mocked(fetch).mockRejectedValueOnce(new Error("Address lookup unavailable."));
  fireEvent.click(screen.getByRole("button", {name:"Receive money"}));
  expect(await screen.findByRole("alert")).toHaveProperty("textContent", "Address lookup unavailable.");
  fireEvent.click(screen.getByRole("button", {name:"Retry"}));
  await screen.findByText(DEMO_WALLET.address);
  fireEvent.click(screen.getByRole("button", {name:"Close"}));
  const address = "0x1111111111111111111111111111111111111111";
  act(() => backend.bus.publish(session, {kind:"receive", address, chain:"Arc_Testnet", tokens:["EURC"]}));
  expect(await screen.findByText(address)).toBeTruthy();
  expect(screen.queryByText(DEMO_WALLET.address)).toBeNull();
});

it("keeps a dismissed lookup closed when its server response arrives late", async () => {
  mount();
  let release!: () => void;
  const hold = new Promise<void>((resolve) => { release = resolve; });
  vi.mocked(fetch).mockImplementationOnce(async (path, init) => {
    await hold;
    return backend.app.request(String(path), init);
  });
  fireEvent.click(screen.getByRole("button", {name:"Receive money"}));
  await screen.findByText("Loading your address…");
  await waitFor(() => expect(vi.mocked(fetch).mock.calls).toHaveLength(1));
  fireEvent.click(screen.getByRole("button", {name:"Close"}));
  await act(async () => { release(); await vi.mocked(fetch).mock.results[0]!.value; });
  expect(screen.queryByRole("dialog")).toBeNull();
  // Legacy clients and voice tools still publish receive cards to their session.
  await act(async () => { await backend.call("POST", "/receive", {}, {"x-arcie-session":session}); });
  expect(await screen.findByText(DEMO_WALLET.address)).toBeTruthy();
});
