import type { ChainId } from "@arcie/core";
import type { AppKitPort, Vault, WalletRef } from "./port.js";

/** Arcie Savings on Arc Testnet. Rates and provider names can change independently of its identity. */
export const SAVINGS_ADDRESS = "0xaabbef1d3971c710276ed41ec791bbe14cdb8e88";

export function isSavingsAddress(chain: ChainId, address: string): boolean {
  return chain === "Arc_Testnet" && address.toLowerCase() === SAVINGS_ADDRESS;
}

export async function findSavings(kit: AppKitPort, chain: ChainId): Promise<Vault | undefined> {
  const vaults = await kit.listVaults(chain, "USDC");
  return vaults.find((v) => v.token === "USDC" && isSavingsAddress(chain, v.address));
}

export type SavingsSummary = {
  available: boolean;
  annualRate: number | null;
  balance: string | null;
  earned: string | null;
};

export async function readSavings(kit: AppKitPort, wallet: WalletRef): Promise<SavingsSummary> {
  const product = await findSavings(kit, wallet.chain);
  if (!product) return { available: false, annualRate: null, balance: null, earned: null };
  const position = await kit.getPosition(wallet, product.address);
  return {
    available: true,
    annualRate: Number.isFinite(product.apy) ? product.apy : null,
    balance: position?.currentBalance ?? "0",
    earned: position ? position.yieldEarned : "0",
  };
}
