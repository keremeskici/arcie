import type { AppKitPort, WalletRef } from "@arcie/appkit";
import type { TokenSymbol } from "@arcie/core";

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Display prices shared by the wallet screen and voice balance. Spending limits have their own valuation. */
export async function readWalletBalances(
  kit: Pick<AppKitPort, "getBalances" | "getUsdRates">,
  wallet: WalletRef,
  tokenUsdPrice?: (token: TokenSymbol) => Promise<number | null>,
) {
  const balances = await kit.getBalances(wallet);
  const appKitRate = async (token: TokenSymbol) => {
    try {
      const rate = (await kit.getUsdRates(wallet.chain, [token]))[token];
      return Number.isFinite(rate) ? rate : null;
    } catch {
      return null;
    }
  };
  const tokens = await Promise.all(balances.map(async (balance) => {
    const amount = Number(balance.amount);
    if (amount === 0 && !tokenUsdPrice) return { ...balance, usd: 0 };
    const price = (await tokenUsdPrice?.(balance.token)) ?? (await appKitRate(balance.token));
    const usd = amount === 0 ? 0 : price === null ? null : round2(amount * price);
    return { ...balance, usd, ...(tokenUsdPrice ? { usdPrice: price } : {}) };
  }));
  const knownSubtotalUsd = round2(tokens.reduce((sum, token) => sum + (token.usd ?? 0), 0));
  const totalUsd = tokens.some((token) => token.usd === null) ? null : knownSubtotalUsd;
  return { tokens, totalUsd, knownSubtotalUsd };
}
