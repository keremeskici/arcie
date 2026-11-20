import { getChain, getWallet, HOME_CHAIN, type AppKitPort, type Fee, type Vault, type WalletRef } from "@arcie/appkit";
import { ArcieError, type ChainId, type TokenSymbol, tokenName } from "@arcie/core";
import { contacts, type Db } from "@arcie/db";
import { eq } from "drizzle-orm";
import { formatUnits, getAddress, isAddress, parseUnits } from "viem";
import type { HarnessCtx } from "./context.js";
import type { EventBus } from "./events.js";
import type { IntentRepo } from "./intents/repo.js";
import type { PolicyProvider } from "./policy/provider.js";

/** Everything the tools and actions share. */
export interface Svc {
  db: Db;
  kit: AppKitPort;
  policy: PolicyProvider;
  bus: EventBus;
  repo: IntentRepo;
  confirmChannels: "any" | "screen";
}

export async function walletFor(svc: Svc, ctx: HarnessCtx, chain: ChainId = HOME_CHAIN): Promise<WalletRef> {
  const w = await getWallet(svc.db, ctx.userId, chain);
  if (!w) throw new ArcieError("NOT_FOUND", { spoken: "Your wallet isn't set up yet." });
  return w;
}

export async function balancesOf(svc: Svc, w: WalletRef): Promise<Record<TokenSymbol, string>> {
  const list = await svc.kit.getBalances(w);
  return Object.fromEntries(list.map((b) => [b.token, b.amount])) as Record<TokenSymbol, string>;
}

/** USD value for limits. Testnet has no cirBTC rate, so fall back to a swap quote into USDC. */
export async function usdValueOf(svc: Svc, w: WalletRef, token: TokenSymbol, amount: string): Promise<number> {
  if (token === "USDC") return Number(amount);
  try {
    const rates = await svc.kit.getUsdRates(w.chain, [token]);
    return Number(amount) * rates[token];
  } catch (e) {
    if (!(e instanceof ArcieError) || e.code !== "CIRCLE_API_ERROR") throw e;
    const q = await svc.kit.estimateSwap(w, { tokenIn: token, tokenOut: "USDC", amountIn: amount, slippageBps: 100 });
    return Number(q.estimatedOut);
  }
}

/** Rounds a long decimal string UP to `decimals` places, so fees are never under-counted. */
export function ceilDecimals(amount: string, decimals: number): string {
  const [int = "0", frac = ""] = amount.split(".");
  if (frac.length <= decimals) return amount;
  const kept = frac.slice(0, decimals);
  const units = BigInt(int + kept) + (/[1-9]/.test(frac.slice(decimals)) ? 1n : 0n);
  const s = units.toString().padStart(decimals + 1, "0");
  const out = `${s.slice(0, -decimals)}.${s.slice(-decimals)}`.replace(/\.?0+$/, "");
  return out === "" ? "0" : out;
}

/** Sums the fees paid in the chain's gas token; null if any is unknown. */
export function gasFeeTotal(fees: Fee[], chain: ChainId): { amount: string | null; token: TokenSymbol } {
  const gas = getChain(chain).gasToken;
  const decimals = getChain(chain).tokens[gas].decimals;
  if (fees.some((f) => f.amount === null)) return { amount: null, token: gas };
  const total = fees
    .filter((f) => (f.token ?? gas) === gas)
    .reduce((s, f) => s + parseUnits(ceilDecimals(f.amount!, decimals), decimals), 0n);
  return { amount: formatUnits(total, decimals), token: gas };
}

export type Recipient = { address: `0x${string}`; label: string; known: boolean };
export type RecipientResult = { kind: "ok"; recipient: Recipient } | { kind: "choice"; options: { id: string; label: string; detail: string }[] };

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

export function resolveRecipient(svc: Svc, userId: string, to: string): RecipientResult {
  const t = to.trim();
  if (/\.eth$/i.test(t)) throw new ArcieError("INVALID_RECIPIENT", { spoken: "I can't send to ENS names yet. Use a contact or an address." });
  const book = svc.db.select().from(contacts).where(eq(contacts.userId, userId)).all();

  if (t.startsWith("0x")) {
    if (!isAddress(t, { strict: true }) || getAddress(t) !== t) throw new ArcieError("INVALID_RECIPIENT", { spoken: "That address needs its correct checksum. Please copy the checksummed address." });
    const address = getAddress(t);
    const c = book.find((x) => x.address.toLowerCase() === address.toLowerCase());
    return { kind: "ok", recipient: c ? { address, label: c.name, known: true } : { address, label: short(address), known: false } };
  }

  const byId = book.find((c) => c.id === t);
  if (byId) return { kind: "ok", recipient: { address: getAddress(byId.address), label: byId.name, known: true } };

  const q = t.toLowerCase();
  let matches = book.filter((c) => c.name.toLowerCase() === q || c.name.toLowerCase().startsWith(`${q} `));
  if (!matches.length) matches = book.filter((c) => c.name.toLowerCase().startsWith(q));
  if (matches.length === 1) {
    const c = matches[0]!;
    return { kind: "ok", recipient: { address: getAddress(c.address), label: c.name, known: true } };
  }
  if (matches.length > 1) {
    return { kind: "choice", options: matches.map((c) => ({ id: c.id, label: c.name, detail: short(c.address) })) };
  }
  throw new ArcieError("INVALID_RECIPIENT", { spoken: `I don't have a contact called ${t}.` });
}

/** "best" = highest APY for the token; otherwise match by address or by name. */
export async function resolveVault(svc: Svc, chain: ChainId, vault: string, token: TokenSymbol = "USDC"): Promise<Vault> {
  const all = await svc.kit.listVaults(chain);
  if (vault === "best") {
    const best = all.filter((v) => v.token === token).sort((a, b) => b.apy - a.apy)[0];
    if (!best) throw new ArcieError("VAULT_UNAVAILABLE", { spoken: `I couldn't find a ${tokenName(token)} vault right now.` });
    return best;
  }
  const q = vault.toLowerCase();
  const found = all.find((v) => v.address.toLowerCase() === q) ?? all.find((v) => v.name.toLowerCase().includes(q));
  if (!found) throw new ArcieError("VAULT_UNAVAILABLE");
  return found;
}

export function joinNames(names: string[]): string {
  return names.length <= 1 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

const NUMBER_WORDS = ["zero", "one", "two", "three", "four", "five"];
export const countWord = (n: number) => NUMBER_WORDS[n] ?? String(n);
