import { describe, expect, it, vi } from "vitest";
import { createTokenUsdPrices } from "./coingecko.js";

const prices = (p: { btc?: number; usdc?: number; eurc?: number }) =>
  new Response(
    JSON.stringify({
      ...(p.btc !== undefined ? { bitcoin: { usd: p.btc } } : {}),
      ...(p.usdc !== undefined ? { "usd-coin": { usd: p.usdc } } : {}),
      ...(p.eurc !== undefined ? { "euro-coin": { usd: p.eurc } } : {}),
    }),
    { status: 200 },
  );
const ok = (btc: number) => prices({ btc, usdc: 0.9998, eurc: 1.08 });

function setup(responses: (() => Response | Promise<Response>)[]) {
  let t = 1_000_000;
  const fetch = vi.fn(async (_url: string, _init?: RequestInit) => {
    const next = responses.shift();
    if (!next) throw new Error("unexpected fetch");
    return next();
  });
  const price = createTokenUsdPrices({ apiKey: "CG-test", fetch: fetch as unknown as typeof globalThis.fetch, now: () => t });
  return { price, fetch, advance: (ms: number) => (t += ms) };
}

describe("CoinGecko token prices (Demo plan)", () => {
  it("prices USDC, EURC and cirBTC with one Demo call", async () => {
    const { price, fetch } = setup([() => ok(67000)]);
    expect(await price("cirBTC")).toBe(67000);
    expect(await price("USDC")).toBe(0.9998);
    expect(await price("EURC")).toBe(1.08);
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe("https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,usd-coin,euro-coin&vs_currencies=usd");
    expect((init?.headers as Record<string, string>)["x-cg-demo-api-key"]).toBe("CG-test");
  });

  it("caches for 5 minutes so a busy app stays under 10k calls a month", async () => {
    const { price, fetch, advance } = setup([() => ok(67000), () => ok(68000)]);
    await price("cirBTC");
    advance(4 * 60_000);
    expect(await price("cirBTC")).toBe(67000);
    expect(fetch).toHaveBeenCalledTimes(1);
    advance(60_001);
    expect(await price("cirBTC")).toBe(68000);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("shares one request between concurrent callers", async () => {
    const { price, fetch } = setup([() => ok(67000)]);
    const all = await Promise.all([price("cirBTC"), price("USDC"), price("EURC")]);
    expect(all).toEqual([67000, 0.9998, 1.08]);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("after a failure, keeps the last prices briefly and waits a minute before retrying", async () => {
    const { price, fetch, advance } = setup([() => ok(67000), () => new Response("{}", { status: 429 }), () => ok(69000)]);
    await price("cirBTC");
    advance(5 * 60_000 + 1);
    expect(await price("cirBTC")).toBe(67000); // 429: last good price, still recent
    advance(30_000);
    expect(await price("EURC")).toBe(1.08); // inside the cooldown: no new request
    expect(fetch).toHaveBeenCalledTimes(2);
    advance(30_001);
    expect(await price("cirBTC")).toBe(69000);
  });

  it("returns null instead of a stale price once the last one is over 30 minutes old", async () => {
    const { price, advance } = setup([() => ok(67000), () => new Response("{}", { status: 500 })]);
    await price("cirBTC");
    advance(31 * 60_000);
    expect(await price("cirBTC")).toBeNull();
  });

  it("returns null for a token missing from the answer, and for a network error", async () => {
    const a = setup([() => prices({ btc: 67000 })]);
    expect(await a.price("cirBTC")).toBe(67000);
    expect(await a.price("EURC")).toBeNull();
    const b = setup([() => Promise.reject(new TypeError("fetch failed"))]);
    expect(await b.price("USDC")).toBeNull();
  });
});
