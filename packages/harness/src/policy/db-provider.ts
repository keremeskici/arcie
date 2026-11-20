import { ArcieError, type AgentLimits } from "@arcie/core";
import { limits, type Db, type DbOrTx } from "@arcie/db";
import { eq } from "drizzle-orm";
import { z } from "zod";
import type { PolicyProvider } from "./provider.js";

const actionKind = z.enum(["send", "swap", "earn_deposit", "earn_withdraw"]);
const tokenSymbol = z.enum(["USDC", "EURC", "cirBTC"]);

export const agentLimitsSchema = z.object({
  maxPerTxUsd: z.number().nonnegative(),
  dailyCapUsd: z.number().nonnegative(),
  allowedActions: z.array(actionKind),
  allowedTokens: z.array(tokenSymbol),
  maxSlippageBps: z.number().int().min(0).max(10_000),
  newRecipientRequiresScreen: z.boolean(),
}) satisfies z.ZodType<AgentLimits>;

export class DbPolicyProvider implements PolicyProvider {
  constructor(private readonly db: Db) {}

  async getLimits(userId: string, tx?: DbOrTx) {
    const row = (await (tx ?? this.db).select().from(limits).where(eq(limits.userId, userId)).limit(1))[0];
    if (!row) throw new ArcieError("NOT_FOUND", { detail: { limitsFor: userId } });
    return { ...agentLimitsSchema.parse(row.json), source: "db" as const };
  }
}
