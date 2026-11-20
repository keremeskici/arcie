import type { TokenSymbol } from "@arcie/core";

/**
 * USD prices for USDC, EURC and cirBTC from CoinGecko's free Demo API, for display only (balances).
 * Spending limits keep using App Kit rates.
 *
 * Demo plan limits (https://www.coingecko.com/en/api/pricing): 100 calls/min and 10,000 calls/month;
 * data is refreshed "from 60 sec". The monthly cap is what binds: 10,000 calls over a 30-day month is
 * one call every ~4.3 minutes. All three prices come from ONE call (1 call = 1 credit), and a 5-minute
 * cache plus one shared in-flight request keeps this process at ≤ ~8,640 calls/month however often
 * the app polls.
 */
const COIN_IDS: Record<TokenSymbol, string> = { cirBTC: "bitcoin", USDC: "usd-coin", EURC: "euro-coin" };
const URL = `https://api.coingecko.com/api/v3/simple/price?ids=${Object.values(COIN_IDS).join(",")}&vs_currencies=usd`;
const TTL_MS = 5 * 60_000;
const RETRY_AFTER_FAILURE_MS = 60_000;
const MAX_STALE_MS = 30 * 60_000;
const TIMEOUT_MS = 5_000;

type Prices = Partial<Record<TokenSymbol, number>>;
export type TokenUsdPrice = (token: TokenSymbol) => Promise<number | null>;

export function createTokenUsdPrices(opts: { apiKey: string; fetch?: typeof globalThis.fetch; now?: () => number }): TokenUsdPrice {
  const doFetch = opts.fetch ?? globalThis.fetch;
  const now = opts.now ?? Date.now;
  let last: { prices: Prices; at: number } | null = null;
  let failedAt = -Infinity;
  let inflight: Promise<Prices | null> | null = null;

  const lastIfRecent = () => (last && now() - last.at <= MAX_STALE_MS ? last.prices : null);

  async function refresh(): Promise<Prices | null> {
    try {
      const res = await doFetch(URL, {
        headers: { accept: "application/json", "x-cg-demo-api-key": opts.apiKey },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!res.ok) throw new Error(`CoinGecko HTTP ${res.status}`);
      const body = (await res.json()) as Record<string, { usd?: unknown } | undefined>;
      const prices: Prices = {};
      for (const [token, id] of Object.entries(COIN_IDS) as [TokenSymbol, string][]) {
        const usd = body[id]?.usd;
        if (typeof usd === "number" && Number.isFinite(usd) && usd > 0) prices[token] = usd;
      }
      if (!Object.keys(prices).length) throw new Error("CoinGecko: no prices in the answer");
      last = { prices, at: now() };
      return prices;
    } catch {
      failedAt = now();
      console.warn("CoinGecko price refresh failed");
      return lastIfRecent();
    }
  }

  async function current(): Promise<Prices | null> {
    if (last && now() - last.at < TTL_MS) return last.prices;
    if (now() - failedAt < RETRY_AFTER_FAILURE_MS) return lastIfRecent();
    inflight ??= refresh().finally(() => (inflight = null));
    return inflight;
  }

  return async (token) => (await current())?.[token] ?? null;
}
