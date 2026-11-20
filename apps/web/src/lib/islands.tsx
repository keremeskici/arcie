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

type Action = { type: "island"; island: IslandPayload } | { type: "clear"; key: "confirm" | "receipt" | "choice" | "receive" | "onramp" };

function reduce(s: IslandState, a: Action): IslandState {
  if (a.type === "clear") return { ...s, [a.key]: null };
  const i = a.island;
  switch (i.kind) {
    case "confirm":
      return { ...s, confirm: i, receipt: null, choice: null };
    case "receipt":
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
};

const Ctx = React.createContext<IslandsApi | null>(null);

/** Opens the server's SSE island stream for this session and keeps the latest island of each kind. */
export function IslandsProvider({ sessionId, children }: { sessionId: string; children: React.ReactNode }) {
  const [state, dispatch] = React.useReducer(reduce, initial);
  const [connected, setConnected] = React.useState(false);

  React.useEffect(() => {
    const es = new EventSource(`/events?sessionId=${encodeURIComponent(sessionId)}`);
    es.onopen = () => setConnected(true);
    es.onerror = () => setConnected(false); // EventSource reconnects on its own
    es.addEventListener("island", (e) => {
      try {
        dispatch({ type: "island", island: JSON.parse((e as MessageEvent<string>).data) as IslandPayload });
      } catch {
        /* ignore malformed frames */
      }
    });
    return () => es.close();
  }, [sessionId]);

  const push = React.useCallback((island: IslandPayload) => dispatch({ type: "island", island }), []);
  const clear = React.useCallback((key: Parameters<IslandsApi["clear"]>[0]) => dispatch({ type: "clear", key }), []);
  const value = React.useMemo(() => ({ ...state, push, clear, connected }), [state, push, clear, connected]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useIslands() {
  const v = React.useContext(Ctx);
  if (!v) throw new Error("useIslands must be used inside IslandsProvider");
  return v;
}
