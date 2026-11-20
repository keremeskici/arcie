import { ArcieError, type ChainId } from "@arcie/core";
import { wallets, type Db } from "@arcie/db";
import { and, eq } from "drizzle-orm";
import { getChain, type ChainConfig } from "./chains.js";
import type { WalletRef } from "./port.js";

/** The slice of the Circle developer-controlled wallets client we use (structurally compatible with the SDK). */
export interface WalletCreator {
  createWallets(input: {
    walletSetId: string;
    blockchains: ChainConfig["circleBlockchain"][];
    count: number;
    accountType: "EOA" | "SCA";
    metadata?: { name?: string; refId?: string }[];
  }): Promise<{ data?: { wallets: { id: string; address: string }[] } }>;
}

export async function getWallet(db: Db, userId: string, chain: ChainId): Promise<WalletRef | null> {
  const row = db
    .select()
    .from(wallets)
    .where(and(eq(wallets.userId, userId), eq(wallets.chain, chain)))
    .get();
  return row ? { chain: row.chain, address: row.address, circleWalletId: row.circleWalletId } : null;
}

/** In-flight creations, so concurrent first logins share one Circle call (single process). */
const inflight = new Map<string, Promise<WalletRef>>();

/** Idempotent per (user, chain): returns the stored wallet or creates one Circle wallet on that chain. */
export async function ensureWallet(
  db: Db,
  circle: WalletCreator,
  opts: { userId: string; chain: ChainId; walletSetId: string; accountType: "EOA" | "SCA" },
): Promise<WalletRef> {
  const existing = await getWallet(db, opts.userId, opts.chain);
  if (existing) return existing;
  const key = `${opts.userId}:${opts.chain}`;
  const pending = inflight.get(key);
  if (pending) return pending;
  const p = createWallet(db, circle, opts).finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

async function createWallet(
  db: Db,
  circle: WalletCreator,
  opts: { userId: string; chain: ChainId; walletSetId: string; accountType: "EOA" | "SCA" },
): Promise<WalletRef> {

  const res = await circle.createWallets({
    walletSetId: opts.walletSetId,
    blockchains: [getChain(opts.chain).circleBlockchain],
    count: 1,
    accountType: opts.accountType,
    metadata: [{ name: `arcie-${opts.userId}`, refId: opts.userId }],
  });
  const created = res.data?.wallets[0];
  if (!created) throw new ArcieError("CIRCLE_API_ERROR", { detail: { createWallets: res } });

  const ref: WalletRef = { chain: opts.chain, address: created.address as `0x${string}`, circleWalletId: created.id };
  db.insert(wallets)
    .values({ id: created.id, userId: opts.userId, chain: opts.chain, circleWalletId: created.id, address: ref.address, accountType: opts.accountType })
    .run();
  return ref;
}
