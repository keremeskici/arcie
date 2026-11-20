import { ensureWallet, HOME_CHAIN, type WalletCreator, type WalletRef } from "@arcie/appkit";
import { DEFAULT_LIMITS, type AgentLimits } from "@arcie/core";
import { audit, limits, users, type Db } from "@arcie/db";
import { and, eq, isNull } from "drizzle-orm";
import { lockUserBudget } from "@arcie/harness";
import { DripReverted } from "./drip.js";
import type { Identity } from "./verifier.js";

export interface OnboardDeps {
  db: Db;
  circle: WalletCreator;
  walletSetId: string;
  /** Optional testnet welcome drip; returns the tx hash. */
  drip?: ((address: `0x${string}`, submitted: (hash: string) => Promise<void>) => Promise<string | null>) | undefined;
}

export type User = typeof users.$inferSelect;

/** Idempotent first-login setup (spec §17): user row, default limits, Circle wallet, one welcome drip. */
export async function onboard(
  deps: OnboardDeps,
  id: Identity,
): Promise<{ user: User; wallet: WalletRef; limits: AgentLimits; dripTx: string | null }> {
  const { db } = deps;
  // The user row must exist to be locked. Every limits writer takes this same per-user budget lock first, so
  // it serializes with execution claims (which read limits and spend under it).
  await db.transaction(async (tx) => {
    await tx.insert(users)
      .values({ id: id.userId, displayName: id.displayName, homeChain: HOME_CHAIN, email: id.email ?? null, linkedWallet: id.linkedWallet ?? null })
      .onConflictDoNothing();
    await lockUserBudget(tx, id.userId);
    await tx.update(users)
      .set({ displayName: id.displayName, ...(id.email ? { email: id.email } : {}), ...(id.linkedWallet ? { linkedWallet: id.linkedWallet } : {}) })
      .where(eq(users.id, id.userId));
    await tx.insert(limits).values({ userId: id.userId, json: DEFAULT_LIMITS }).onConflictDoNothing();
  });

  const wallet = await ensureWallet(db, deps.circle, { userId: id.userId, chain: HOME_CHAIN, walletSetId: deps.walletSetId, accountType: "EOA" });

  let dripTx: string | null = null;
  if (deps.drip) {
    // Compare-and-set claim so two racing logins can't both drip.
    const claimed = (await db
      .update(users)
      .set({ welcomeDripAt: new Date().toISOString() })
      .where(and(eq(users.id, id.userId), isNull(users.welcomeDripAt)))
      .returning({ id: users.id })).length === 1;
    if (claimed) {
      try {
        const record = async (hash: string) => {
          await db.update(users).set({ welcomeDripTx: hash }).where(eq(users.id, id.userId));
        };
        dripTx = await deps.drip(wallet.address, record);
        if (dripTx) await db.update(users).set({ welcomeDripTx: dripTx }).where(and(eq(users.id, id.userId), isNull(users.welcomeDripTx)));
      } catch (e) {
        // Never reset the claim: an ambiguous send may have landed, and a second automatic payment is worse.
        const status = e instanceof DripReverted ? "reverted" : "uncertain";
        await db.insert(audit).values({ userId: id.userId, type: `welcome_drip.${status}`, payload: { status } });
      }
    }
  }

  const [user] = await db.select().from(users).where(eq(users.id, id.userId)).limit(1);
  const [row] = await db.select().from(limits).where(eq(limits.userId, id.userId)).limit(1);
  return { user: user!, wallet, limits: row!.json, dripTx };
}
