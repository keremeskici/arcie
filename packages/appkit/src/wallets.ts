import { ArcieError, type ChainId } from "@arcie/core";
import { randomUUID } from "node:crypto";
import { walletProvisioning, wallets, type DbOrTx } from "@arcie/db";
import { and, eq, sql } from "drizzle-orm";
import { getChain, type ChainConfig } from "./chains.js";
import type { WalletRef } from "./port.js";

/** The slice of the Circle developer-controlled wallets client we use (structurally compatible with the SDK). */
export interface WalletCreator {
  createWallets(input: {
    /** Circle expects a UUID v4; one key per (user, chain) provisioning. */
    idempotencyKey: string;
    walletSetId: string;
    blockchains: ChainConfig["circleBlockchain"][];
    count: number;
    accountType: "EOA" | "SCA";
    metadata?: { name?: string; refId?: string }[];
  }): Promise<{ data?: { wallets: { id: string; address: string }[] } }>;
}

export async function getWallet(db: DbOrTx, userId: string, chain: ChainId): Promise<WalletRef | null> {
  const [row] = await db
    .select()
    .from(wallets)
    .where(and(eq(wallets.userId, userId), eq(wallets.chain, chain)))
    .limit(1);
  return row ? { chain: row.chain, address: row.address, circleWalletId: row.circleWalletId } : null;
}

/**
 * Idempotent per (user, chain). The provisioning row (with its Circle idempotency key) is stored first, so
 * every caller on every instance replays one creation; a Circle failure leaves it `uncertain` and a retry
 * reuses the same key. No transaction is open during the Circle call.
 */
export async function ensureWallet(
  db: DbOrTx,
  circle: WalletCreator,
  opts: { userId: string; chain: ChainId; walletSetId: string; accountType: "EOA" | "SCA" },
): Promise<WalletRef> {
  const existing = await getWallet(db, opts.userId, opts.chain);
  if (existing) return existing;

  await db.insert(walletProvisioning)
    .values({ userId: opts.userId, chain: opts.chain, idempotencyKey: randomUUID(), status: "pending" })
    .onConflictDoNothing();
  const [prov] = await db.select().from(walletProvisioning)
    .where(and(eq(walletProvisioning.userId, opts.userId), eq(walletProvisioning.chain, opts.chain)))
    .limit(1);
  if (!prov) throw new ArcieError("CIRCLE_API_ERROR", { detail: { provisioning: "row missing" } });

  const setStatus = (status: "created" | "uncertain") =>
    db.update(walletProvisioning).set({ status, updatedAt: sql`now()` })
      .where(and(eq(walletProvisioning.userId, opts.userId), eq(walletProvisioning.chain, opts.chain)));

  let created: { id: string; address: string } | undefined;
  try {
    const res = await circle.createWallets({
      idempotencyKey: prov.idempotencyKey,
      walletSetId: opts.walletSetId,
      blockchains: [getChain(opts.chain).circleBlockchain],
      count: 1,
      accountType: opts.accountType,
      metadata: [{ name: `arcie-${opts.userId}`, refId: opts.userId }],
    });
    created = res.data?.wallets[0];
    if (!created) throw new ArcieError("CIRCLE_API_ERROR", { detail: { createWallets: res } });
  } catch (e) {
    await setStatus("uncertain");
    throw e;
  }

  await db.insert(wallets)
    .values({ id: created.id, userId: opts.userId, chain: opts.chain, circleWalletId: created.id, address: created.address as `0x${string}`, accountType: opts.accountType })
    .onConflictDoNothing(); // any unique conflict (id or user+chain) means another caller stored this wallet
  await setStatus("created");
  const stored = await getWallet(db, opts.userId, opts.chain);
  if (!stored) throw new ArcieError("CIRCLE_API_ERROR", { detail: { provisioning: "wallet row missing" } });
  return stored;
}
