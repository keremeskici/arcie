import type { ActionKind, ArcieError, ReceiptIsland } from "@arcie/core";
import { tokenName } from "@arcie/core";

/** Receipt: actual values side by side with what the confirm card estimated (spec §9.2). */
export function buildReceipt(i: {
  intentId: string;
  status: "succeeded" | "failed";
  estimated: Record<string, string | null>;
  actual: Record<string, string | null>;
  txHash?: string;
  explorerUrl?: string;
  newBalance?: string;
  elapsedMs: number;
  error?: ArcieError;
  nextStep?: { label: string; utterance: string };
}): ReceiptIsland {
  const labels = [...new Set([...Object.keys(i.estimated), ...Object.keys(i.actual)])];
  const r: ReceiptIsland = {
    kind: "receipt",
    intentId: i.intentId,
    status: i.status,
    rows: labels.map((label) => ({ label, estimated: i.estimated[label] ?? null, actual: i.actual[label] ?? null })),
    elapsedMs: i.elapsedMs,
  };
  if (i.txHash) r.txHash = i.txHash;
  if (i.explorerUrl) r.explorerUrl = i.explorerUrl;
  if (i.newBalance) r.newBalance = i.newBalance;
  if (i.error) r.error = { code: i.error.code, message: i.error.spoken };
  if (i.nextStep) r.nextStep = i.nextStep;
  return r;
}

/** At most one next step per receipt. */
export function nextStepFor(kind: ActionKind, params: { tokenOut?: string }): { label: string; utterance: string } | undefined {
  if (kind === "swap" && (params.tokenOut === "EURC" || params.tokenOut === "USDC")) {
    return { label: "Earn on it", utterance: `put my ${tokenName(params.tokenOut)} somewhere it earns` };
  }
  if (kind === "earn_deposit") return { label: "Check my earnings", utterance: "how are my earnings" };
  return undefined;
}
