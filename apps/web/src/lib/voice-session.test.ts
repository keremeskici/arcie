import { afterEach, expect, it, vi } from "vitest";
import { api, setSessionId, setTokenGetter } from "./api";
import { requestVoiceSession } from "./voice-session";

afterEach(() => vi.unstubAllGlobals());

it("mints for every new conversation and ignores an older response after closing and reopening", async () => {
  const pending: ((response: Response) => void)[] = [];
  vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>((resolve) => { pending.push(resolve); })));
  const selected = vi.fn(), error = vi.fn();
  const first = requestVoiceSession(selected, error);
  await vi.waitFor(() => expect(pending).toHaveLength(1));
  pending[0]!(Response.json({ sessionId: "first" }));
  await vi.waitFor(() => expect(selected).toHaveBeenCalledWith("first"));
  first();
  const closing = requestVoiceSession(selected, error);
  await vi.waitFor(() => expect(pending).toHaveLength(2));
  closing();
  const reopened = requestVoiceSession(selected, error);
  await vi.waitFor(() => expect(pending).toHaveLength(3));
  pending[2]!(Response.json({ sessionId: "fresh" }));
  pending[1]!(Response.json({ sessionId: "late" }));
  await vi.waitFor(() => expect(selected.mock.calls).toEqual([["first"], ["fresh"]]));
  expect(error).not.toHaveBeenCalled();
  reopened();
});

it("keeps earlier cards in their original session and uses an owner-only read for pending settlement", async () => {
  const fetcher = vi.fn(async (_url: RequestInfo | URL, _options?: RequestInit) => Response.json({}));
  vi.stubGlobal("fetch", fetcher);
  let release!: () => void;
  const pause = new Promise<void>((resolve) => { release = resolve; });
  setTokenGetter(async () => { await pause; return "test"; });
  try {
    setSessionId("screen");
    const inFlight = api.post("/intents", {});
    setSessionId("voice");
    release();
    await inFlight;
    await api.post("/intents/card/confirm", { revision: 2 }, "screen");
    await api.get("/intents/card", undefined, null);
    const headers = fetcher.mock.calls.map(([, options]) => new Headers(options?.headers));
    expect(headers.map((h) => h.get("x-arcie-session"))).toEqual(["screen", "screen", null]);
    expect(headers.every((h) => h.get("authorization") === "Bearer test")).toBe(true);
  } finally { setSessionId(null); setTokenGetter(async () => null); }
});
