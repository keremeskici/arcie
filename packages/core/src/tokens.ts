/**
 * What people see and hear. The onchain symbols (USDC, EURC, cirBTC) stay in tool arguments,
 * the API, the database and intent hashes; only display and spoken text use these names.
 */
const DISPLAY: Record<string, string> = { USDC: "USD", EURC: "EUR", cirBTC: "BTC" };

export function tokenName(symbol: string): string {
  return DISPLAY[symbol] ?? symbol;
}

/** "5 USD" from ("5", "USDC"). */
export function money(amount: string, symbol: string): string {
  return `${amount} ${tokenName(symbol)}`;
}
