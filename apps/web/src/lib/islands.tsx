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
import { api } from "./api";
import { watchIntent } from "./intent-status";

export function confirmKey(island: ConfirmIsland) {
  return `${island.intentId}/${island.revision ?? island.expiresAt}`;
}

/** What the screen shows right now. The server is the source of truth; this mirrors its island stream. */
export type IslandState = {
  confirm: ConfirmIsland | null;
  confirmSession: string | null;
  choiceSession: string | null;
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
  confirmSession: null,
  choiceSession: null,
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
type Action =
  | { type: "island" | "observed"; island: IslandPayload; sessionId?: string }
  | { type: "clear"; key: ClearKey; id?: string }
  | { type: "refreshBalances" };

function reduce(s: IslandState, a: Action): IslandState {
  if (a.type === "clear") {
    if (a.key === "choice") {
      if (a.id && a.id !== s.choice?.choiceId) return s;
      return { ...s, choice: null, choiceSession: null };
    }
    if (a.key === "openScreen" && a.id && a.id !== s.openScreen?.requestId) return s;
    if (a.key === "confirm" || a.key === "receipt") {
      if (a.id && a.id !== s[a.key]?.intentId) return s;
      if (a.key === "confirm") return { ...s, confirm: null, confirmSession: null, processing: null };
    }
    return { ...s, [a.key]: null };
  }
  if (a.type === "refreshBalances") return { ...s, balanceTick: s.balanceTick + 1 };
  const i = a.island;
  if (a.type === "observed" && i.kind === "confirm" && s.confirm?.intentId !== i.intentId) return s;
  switch (i.kind) {
    case "confirm": {
      const previous = s.confirm?.intentId === i.intentId ? s.confirm : null;
      if (s.receipt?.intentId === i.intentId) return s;
      if (previous && (previous.revision != null
        ? previous.revision >= (i.revision ?? -1)
        : confirmKey(previous) === confirmKey(i))) return s;
      return {
        ...s,
        confirm: i,
        confirmSession: a.sessionId ?? (previous ? s.confirmSession : null),
        processing: null,
        receipt: null,
        choice: null,
        choiceSession: null,
      };
    }
    case "processing": {
      if (s.confirm?.intentId !== i.intentId) return s;
      if (s.processing?.unverified && !i.unverified) return s;
      if (s.processing && s.processing.unverified === i.unverified && s.processing.summary === i.summary) return s;
      return { ...s, processing: i };
    }
    case "receipt":
      if (s.receipt?.intentId === i.intentId && s.receipt.status === i.status) return s;
      return {
        ...s,
        receipt: i,
        confirm: s.confirm?.intentId === i.intentId ? null : s.confirm,
        confirmSession: s.confirm?.intentId === i.intentId ? null : s.confirmSession,
        processing: s.processing?.intentId === i.intentId ? null : s.processing,
        balanceTick: s.balanceTick + 1,
      };
    case "dismiss":
      return s.confirm?.intentId === i.intentId ? { ...s, confirm: null, confirmSession: null, processing: null } : s;
    case "choice":
      return { ...s, choice: i, choiceSession: a.sessionId ?? null };
    case "dismiss_choice":
      return s.choice?.choiceId === i.choiceId ? { ...s, choice: null, choiceSession: null } : s;
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
  push: (island: IslandPayload, origin?: string | null) => void;
  refreshBalances: () => void;
  clear: (key: ClearKey, id?: string) => void;
  connected: boolean;
  verifying: ReadonlySet<string>;
  verify: (id: string) => void;
};

const Ctx = React.createContext<IslandsApi | null>(null);

/** Opens the server's SSE island stream for this session and keeps the latest island of each kind. */
export function IslandsProvider({ sessionId, voiceSessionId = null, children }: {
  sessionId: string;
  voiceSessionId?: string | null;
  children: React.ReactNode;
}) {
  const [state, dispatch] = React.useReducer(reduce, initial);
  const [connected, setConnected] = React.useState(false);

  const [verifying, setVerifying] = React.useState<ReadonlySet<string>>(() => new Set());
  const watchers = React.useRef(new Map<string, () => void>());
  const markVerifying = React.useCallback((id: string, pending: boolean) => {
    setVerifying(current => {
      if (current.has(id) === pending) return current;
      const next = new Set(current);
      if (pending) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);
  const watch = React.useCallback((id: string, replace = false) => {
    const active = watchers.current.get(id);
    if (active && !replace) return;
    active?.();
    watchers.current.set(id, watchIntent((signal) => api.get(`/intents/${encodeURIComponent(id)}`, signal, null), (row) => {
      const pending = row.status === "executing" || row.checking === true;
      markVerifying(id, pending);
      if (row.island) dispatch({ type: "observed", island: row.island });
      if (row.status === "executing" && !row.island) {
        const island: ProcessingIsland = { kind: "processing", intentId: id };
        if (row.statusReason === "submission_unknown") {
          island.unverified = true;
          island.summary = row.error?.message ?? "Check your activity before trying again.";
        }
        dispatch({ type: "observed", island });
      } else if (row.status !== "awaiting_confirmation") {
        if (!row.island) dispatch({ type: "island", island: { kind: "dismiss", reason: row.status === "expired" ? "expired" : "cancelled", intentId: id } });
      }
    }, () => watchers.current.delete(id)));
  }, [markVerifying]);
  const verify = React.useCallback((id: string) => { markVerifying(id, true); watch(id, true); }, [markVerifying, watch]);
  React.useEffect(() => {
    if (state.confirm) watch(state.confirm.intentId);
  }, [state.confirm, watch]);

  const subscribe = React.useCallback((origin: string, walletStream: boolean) => {
    const es = new EventSource(`/events?sessionId=${encodeURIComponent(origin)}`);
    const controller = new AbortController();
    if (walletStream) {
      es.onopen = () => {
        if (controller.signal.aborted) return;
        setConnected(true);
        void api.get<{ executing: string[] }>("/activity?executing=1", controller.signal, null).then(({ executing }) => {
          if (!controller.signal.aborted) for (const id of executing) watch(id);
        }).catch(() => {});
      };
      es.onerror = () => { if (!controller.signal.aborted) setConnected(false); };
    }
    es.addEventListener("island", (e) => {
      if (controller.signal.aborted) return;
      try {
        dispatch({ type: "island", sessionId: origin, island: JSON.parse((e as MessageEvent<string>).data) as IslandPayload });
      } catch {
        /* ignore malformed frames */
      }
    });
    return () => {
      controller.abort();
      es.close();
    };
  }, [watch]);

  React.useEffect(() => subscribe(sessionId, true), [sessionId, subscribe]);
  React.useEffect(() => {
    if (voiceSessionId && voiceSessionId !== sessionId) return subscribe(voiceSessionId, false);
  }, [voiceSessionId, sessionId, subscribe]);

  React.useEffect(() => () => {
    for (const stop of watchers.current.values()) stop();
    watchers.current.clear();
  }, []);
  const push = React.useCallback((island: IslandPayload, origin?: string | null) => dispatch({ type: "island", sessionId: origin ?? sessionId, island }), [sessionId]);
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
  const value = React.useMemo(() => ({ ...state, push, clear, connected, refreshBalances, verifying, verify }),
    [state, push, clear, connected, refreshBalances, verifying, verify]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useIslands() {
  const v = React.useContext(Ctx);
  if (!v) throw new Error("useIslands must be used inside IslandsProvider");
  return v;
}
