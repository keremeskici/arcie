import type { Fee } from "@arcie/appkit";
import type { RichText } from "@arcie/core";
import { tokenName } from "@arcie/core";

const SUFFIX = "Say confirm, or tap the card.";
const MAX_WORDS = 25;

/** Fixed button meanings (spec §9.2). */
export const BUTTONS = { confirm: "I've checked the details; do it now.", cancel: "Don't do this." } as const;

const wordCount = (s: string) => s.trim().split(/\s+/).length;

/** `${core} Say confirm, or tap the card.`; throws if longer than 25 words. */
export function spokenPrompt(core: string): string {
  const out = `${core.trim()} ${SUFFIX}`;
  if (wordCount(out) > MAX_WORDS) throw new Error(`spokenPrompt over ${MAX_WORDS} words: "${out}"`);
  return out;
}

/** Tries the detailed core first and falls back to a short one, so a long name never breaks a proposal. */
export function promptWithFallback(full: string, short: string): string {
  try {
    return spokenPrompt(full);
  } catch {
    return spokenPrompt(short);
  }
}

/** Display rounding for fees only (principal amounts are shown exactly). */
export function displayAmount(amount: string): string {
  const n = Number(amount);
  if (n === 0) return "0";
  if (n < 0.0001) return "<0.0001";
  return String(Number.parseFloat(n.toFixed(4)));
}

export function feeValue(f: Fee): string | null {
  return f.amount === null ? null : `${displayAmount(f.amount)}${f.token ? ` ${tokenName(f.token)}` : ""}`;
}

export function feeRows(fees: Fee[]): { label: string; value: string | null; estimate: true }[] {
  return fees.map((f) => ({ label: f.label, value: feeValue(f), estimate: true }));
}

/** Short spoken fee phrase; empty when any fee is unknown (the card shows "—"). */
export function feePhrase(fees: Fee[]): string {
  if (!fees.length || fees.some((f) => f.amount === null)) return "";
  const token = fees[0]!.token;
  if (token === null || fees.some((f) => f.token !== token)) return "fees shown on the card";
  const total = fees.reduce((s, f) => s + Number(f.amount), 0);
  return token === "USDC" && total < 0.01 ? "fee under a cent" : `fees about ${displayAmount(String(total))} ${tokenName(token)}`;
}

export function apyText(apy: number | null): string | null {
  return apy === null ? null : `${Number.parseFloat((apy * 100).toFixed(2))}%`;
}

/** Rich text from plain strings and { b: "bold" } segments. */
export function rt(...parts: (string | { b: string })[]): RichText {
  return parts.map((p) => (typeof p === "string" ? { text: p } : { text: p.b, bold: true }));
}

/** Appends adjustments and risks as plain sentences. */
export function withNotes(text: RichText, adjustments: string[], risks: string[]): RichText {
  return [...text, ...[...adjustments, ...risks].map((s) => ({ text: ` ${s}` }))];
}
