import { formatUnits, parseUnits } from "viem";
import { ArcieError } from "./errors.js";

/** Positive decimal string: no sign, no leading zeros, no leading dot, no separators. */
const AMOUNT_RE = /^(0|[1-9]\d*)(\.\d+)?$/;

export function isValidAmountString(s: string, decimals: number): boolean {
  const m = AMOUNT_RE.exec(s);
  if (!m) return false;
  const fraction = m[2]?.slice(1) ?? "";
  if (fraction.length > decimals) return false;
  return parseUnits(s, decimals) > 0n;
}

export function parseAmount(input: string, decimals: number): bigint {
  if (!isValidAmountString(input, decimals)) {
    throw new ArcieError("INVALID_AMOUNT", { detail: { input, decimals } });
  }
  return parseUnits(input, decimals);
}

/** viem's formatUnits already drops trailing zeros ("4.61", "5"). */
export function formatAmount(units: bigint, decimals: number): string {
  return formatUnits(units, decimals);
}
