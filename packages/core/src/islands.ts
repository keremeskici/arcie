import type { ActionKind, TokenSymbol } from "./types.js";

/** Island payloads (spec §9.1). The server owns them and pushes them over SSE. */
export type RichText = { text: string; bold?: boolean }[];

/** Browser-safe checkout fields; never includes the server API key. */
export type OnrampSession = {
  sessionId?: string;
  sessionToken: string;
  widgetUrl: string;
  expiresAt: string;
  environment: "sandbox" | "production";
};

export type IslandPayload =
  | {
      kind: "steps";
      runId: string;
      steps: { id: string; label: string; status: "running" | "done" | "failed"; error?: string }[];
      elapsedMs: number;
    }
  | {
      kind: "choice";
      choiceId: string;
      question: string;
      options: { id: string; label: string; detail?: string }[];
      send?: { amount: string; token: TokenSymbol };
      expiresAt?: string;
    }
  | { kind: "dismiss_choice"; choiceId: string }
  | { kind: "open_screen"; screen: "activity" | "contacts"; requestId: string }
  | {
      kind: "confirm";
      action?: ActionKind;
      send?: { amount: string; token: TokenSymbol; recipient: string; address?: string };
      intentId: string;
      /** Phrased as a question naming the exact action and size. */
      title: string;
      chips: string[];
      /** value null is rendered as "—". */
      rows: { label: string; value: string | null; estimate?: boolean }[];
      adjustments: string[];
      risks: string[];
      disclosure: RichText;
      /** Stated meanings of the two buttons. */
      buttons: { confirm: string; cancel: string };
      expiresAt: string;
      spokenPrompt: string;
    }
  | { kind: "processing"; intentId: string; unverified?: true; summary?: string }
  | {
      kind: "receipt";
      intentId: string;
      status: "succeeded" | "failed";
      rows: { label: string; estimated: string | null; actual: string | null }[];
      txHash?: string;
      explorerUrl?: string;
      newBalance?: string;
      elapsedMs: number;
      error?: { code: string; message: string };
      nextStep?: { label: string; utterance: string };
    }
  | ({ kind: "onramp"; destinationAddress: string; amount?: string; token: string; requestId?: string } & OnrampSession)
  | { kind: "receive"; address: string; chain: string; tokens: string[] }
  /** Fresh balances after money arrives outside a confirm flow (e.g. onramp settled). */
  | { kind: "balances"; chain: string; balances: { token: string; amount: string }[] }
  /** Tells the client to remove a confirm card that can no longer be confirmed. */
  | { kind: "dismiss"; intentId: string; reason: "cancelled" | "superseded" | "expired" };

export type StepsIsland = Extract<IslandPayload, { kind: "steps" }>;
export type ChoiceIsland = Extract<IslandPayload, { kind: "choice" }>;
export type ConfirmIsland = Extract<IslandPayload, { kind: "confirm" }>;
export type ProcessingIsland = Extract<IslandPayload, { kind: "processing" }>;
export type ReceiptIsland = Extract<IslandPayload, { kind: "receipt" }>;
export type OnrampIsland = Extract<IslandPayload, { kind: "onramp" }>;
export type ReceiveIsland = Extract<IslandPayload, { kind: "receive" }>;
export type BalancesIsland = Extract<IslandPayload, { kind: "balances" }>;
export type DismissIsland = Extract<IslandPayload, { kind: "dismiss" }>;
