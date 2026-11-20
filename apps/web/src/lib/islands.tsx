import type {
  ChoiceIsland,
  ConfirmIsland,
  IslandPayload,
  OnrampIsland,
  ReceiptIsland,
  ReceiveIsland,
  StepsIsland,
} from "@arcie/core";
import * as React from "react";
import { api } from "./api";
import { watchIntent } from "./intent-status";

/** What the screen shows right now. The server is the source of truth; this mirrors its island stream. */
export type IslandState = {
  confirm: ConfirmIsland | null;
  receipt: ReceiptIsland | null;
  choice: ChoiceIsland | null;
  steps: StepsIsland | null;
  receive: ReceiveIsland | null;
  onramp: OnrampIsland | null;
  /** Bumped whenever balances may have changed. */
  balanceTick: number;
};

const initial: IslandState = {
  confirm: null,
  receipt: null,
  choice: null,
  steps: null,
  receive: null,
  onramp: null,
  balanceTick: 0,
};

type Action = { type: "island" | "observed"; island: IslandPayload } | { type: "clear"; key: "confirm" | "receipt" | "choice" | "receive" | "onramp" };

function reduce(s: IslandState, a: Action): IslandState {
  if (a.type === "clear") return { ...s, [a.key]: null };
  const i = a.island;
  if (a.type === "observed" && i.kind === "confirm" && s.confirm?.intentId !== i.intentId) return s;
  switch (i.kind) {
    case "confirm":
      if (s.receipt?.intentId === i.intentId || (s.confirm?.intentId === i.intentId && (s.confirm.revision ?? -1) >= (i.revision ?? -1))) return s;
      return { ...s, confirm: i, receipt: null, choice: null };
    case "receipt":
      if (s.receipt?.intentId === i.intentId) return s;
      return {
        ...s,
        receipt: i,
        confirm: s.confirm?.intentId === i.intentId ? null : s.confirm,
        balanceTick: s.balanceTick + 1,
      };
    case "dismiss":
      return s.confirm?.intentId === i.intentId ? { ...s, confirm: null } : s;
    case "choice":
      return { ...s, choice: i };
    case "steps":
      return { ...s, steps: i };
    case "receive":
      return { ...s, receive: i };
    case "onramp":
      return { ...s, onramp: i };
    case "balances":
      return { ...s, balanceTick: s.balanceTick + 1 };
  }
}

type IslandsApi = IslandState & {
  push: (island: IslandPayload) => void;
  clear: (key: "confirm" | "receipt" | "choice" | "receive" | "onramp") => void;
  connected: boolean;
  verifying: string | null;
  verify: (id: string) => void;
};

const Ctx = React.createContext<IslandsApi | null>(null);

/** Opens the server's SSE island stream for this session and keeps the latest island of each kind. */
export function IslandsProvider({ sessionId, children }: { sessionId: string; children: React.ReactNode }) {
  const [state, dispatch] = React.useReducer(reduce, initial);
  const [connected, setConnected] = React.useState(false);

  const [verifying, setVerifying] = React.useState<string | null>(null);
  const watchers = React.useRef(new Map<string, () => void>());
  const watch = React.useCallback((id: string, replace = false) => {
    const active = watchers.current.get(id);
    if (active && !replace) return;
    active?.();
    watchers.current.set(id, watchIntent((signal) => api.get(`/intents/${encodeURIComponent(id)}`, signal), (row) => {
      const pending = row.status === "executing" || row.checking === true;
      setVerifying((old) => pending ? id : old === id ? null : old);
      if (row.island) dispatch({ type: "observed", island: row.island });
      if (row.status !== "executing" && row.status !== "awaiting_confirmation") {
        watchers.current.delete(id);
        if (!row.island) dispatch({ type: "island", island: { kind: "dismiss", reason: row.status === "expired" ? "expired" : "cancelled", intentId: id } });
      }
    }));
  }, []);
  const verify = React.useCallback((id: string) => { setVerifying(id); watch(id, true); }, [watch]);
  React.useEffect(() => {
    if (state.confirm) watch(state.confirm.intentId);
  }, [state.confirm, watch]);

  React.useEffect(() => {
    const es = new EventSource(`/events?sessionId=${encodeURIComponent(sessionId)}`);
    const controller = new AbortController();
    es.onopen = () => {
      setConnected(true);
      void api.get<{ executing: string[] }>("/activity?executing=1", controller.signal).then(({ executing }) => {
        if (!controller.signal.aborted) for (const id of executing) watch(id);
      }).catch(() => {});
    };
    es.onerror = () => setConnected(false); // EventSource reconnects on its own
    es.addEventListener("island", (e) => {
      try {
        dispatch({ type: "island", island: JSON.parse((e as MessageEvent<string>).data) as IslandPayload });
      } catch {
        /* ignore malformed frames */
      }
    });
    return () => {
      controller.abort();
      es.close();
      for (const stop of watchers.current.values()) stop();
      watchers.current.clear();
    };
  }, [sessionId, watch]);

  const push = React.useCallback((island: IslandPayload) => dispatch({ type: "island", island }), []);
  const clear = React.useCallback((key: Parameters<IslandsApi["clear"]>[0]) => dispatch({ type: "clear", key }), []);
  const value = React.useMemo(() => ({ ...state, push, clear, connected, verifying, verify }), [state, push, clear, connected, verifying, verify]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useIslands() {
  const v = React.useContext(Ctx);
  if (!v) throw new Error("useIslands must be used inside IslandsProvider");
  return v;
}
