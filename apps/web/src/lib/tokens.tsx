import { isValidAmountString } from "@arcie/core";
import { TokenBTC, TokenEURC, TokenUSDC } from "@web3icons/react";
import type * as React from "react";
import { cn } from "@/lib/cn";

/**
 * How tokens appear on screen. The server and the API keep the real symbols (USDC, EURC, cirBTC);
 * only the label shown to people is simplified.
 */
const TOKENS: Record<string, { label: string; Icon: React.ComponentType<{ size?: number | string; variant?: "mono" | "branded" | "background"; className?: string }> }> = {
  USDC: { label: "USD", Icon: TokenUSDC },
  EURC: { label: "EUR", Icon: TokenEURC },
  cirBTC: { label: "BTC", Icon: TokenBTC }, // web3icons has no cirBTC icon; it's Circle's wrapped BTC
};

export const tokenLabel = (symbol: string) => TOKENS[symbol]?.label ?? symbol;

export const walletCurrencies = ["USDC", "EURC", "cirBTC"] as const;

/** Accept a leading decimal point from the keypad and preserve the exact token amount. */
export function enteredAmount(text: string, symbol: string): string | null {
  const amount = text.startsWith(".") ? `0${text}` : text;
  return isValidAmountString(amount, symbol === "cirBTC" ? 8 : 6) ? amount : null;
}

export function TokenIcon({ symbol, size = 32, className }: { symbol: string; size?: number; className?: string }) {
  const t = TOKENS[symbol];
  if (!t) return <span className={cn("inline-block rounded-full bg-card-2", className)} style={{ width: size, height: size }} />;
  return <t.Icon size={size} variant="branded" className={cn("shrink-0", className)} />;
}
