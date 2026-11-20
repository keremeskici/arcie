import type {
  ChoiceIsland,
  ConfirmIsland,
  IslandPayload,
  OnrampIsland,
  ProcessingIsland,
  ReceiptIsland,
  ReceiveIsland,
  StepsIsland,
} from "@arcie/core";
import * as React from "react";

/** What the screen shows right now. The server is the source of truth; this mirrors its island stream. */
export type IslandState = {
  confirm: ConfirmIsland | null;
  processing: ProcessingIsland | null;
  receipt: ReceiptIsland | null;
  choice: ChoiceIsland | null;
  steps: StepsIsland | null;
  receive: ReceiveIsland | null;
  onramp: OnrampIsland | null;
  openScreen: Extract<IslandPayload, { kind: "open_screen" }> | null;
  /** Bumped whenever balances may have changed. */
  balanceTick: number;
};

const initial: IslandState = {
  confirm: null,
  processing: null,
  receipt: null,
  choice: null,
  steps: null,
  receive: null,
  onramp: null,
  openScreen: null,
  balanceTick: 0,
};

type ClearKey = "confirm" | "receipt" | "choice" | "receive" | "onramp" | "openScreen";
type Action = { type: "island"; island: IslandPayload } | { type: "clear"; key: ClearKey; id?: string } | { type: "refreshBalances" };

function reduce(s: IslandState, a: Action): IslandState {
  if (a.type === "clear") {
    if (a.key === "choice" && a.id && a.id !== s.choice?.choiceId) return s;
    if (a.key === "openScreen" && a.id && a.id !== s.openScreen?.requestId) return s;
    if (a.key === "confirm" || a.key === "receipt") {
      if (a.id && a.id !== s[a.key]?.intentId) return s;
      if (a.key === "confirm") return { ...s, confirm: null, processing: null };
    }
    return { ...s, [a.key]: null };
  }
  if (a.type === "refreshBalances") return { ...s, balanceTick: s.balanceTick + 1 };
  const i = a.island;
  switch (i.kind) {
    case "confirm":
      if (s.receipt?.intentId === i.intentId || (s.confirm?.intentId === i.intentId && s.confirm.expiresAt === i.expiresAt)) return s;
      return { ...s, confirm: i, processing: null, receipt: null, choice: null };
    case "processing":
      return s.confirm?.intentId === i.intentId ? { ...s, processing: i } : s;
    case "receipt":
      if (s.receipt?.intentId === i.intentId && s.receipt.status === i.status) return s;
      return {
        ...s,
        receipt: i,
        confirm: s.confirm?.intentId === i.intentId ? null : s.confirm,
        processing: s.processing?.intentId === i.intentId ? null : s.processing,
        balanceTick: s.balanceTick + 1,
      };
    case "dismiss":
      return s.confirm?.intentId === i.intentId ? { ...s, confirm: null, processing: null } : s;
    case "choice":
      return { ...s, choice: i };
    case "dismiss_choice":
      return s.choice?.choiceId === i.choiceId ? { ...s, choice: null } : s;
    case "steps":
      return { ...s, steps: i };
    case "receive":
      return { ...s, receive: i };
    case "onramp":
      return { ...s, onramp: i };
    case "open_screen":
      return { ...s, openScreen: i };
    case "balances":
      return { ...s, balanceTick: s.balanceTick + 1 };
  }
}

type IslandsApi = IslandState & {
  push: (island: IslandPayload) => void;
  refreshBalances: () => void;
  clear: (key: ClearKey, id?: string) => void;
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
  const refreshBalances = React.useCallback(() => dispatch({ type: "refreshBalances" }), []);
  const clear = React.useCallback((key: ClearKey, id?: string) => dispatch({ type: "clear", key, id }), []);
  React.useEffect(() => {
    const choice = state.choice;
    if (!choice?.expiresAt) return;
    const expiresAt = Date.parse(choice.expiresAt);
    if (!Number.isFinite(expiresAt)) return;
    const timeout = setTimeout(() => clear("choice", choice.choiceId), Math.max(0, expiresAt - Date.now()));
    return () => clearTimeout(timeout);
  }, [state.choice, clear]);
  const value = React.useMemo(() => ({ ...state, push, clear, connected, refreshBalances }), [state, push, clear, connected, refreshBalances]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useIslands() {
  const v = React.useContext(Ctx);
  if (!v) throw new Error("useIslands must be used inside IslandsProvider");
  return v;
}
