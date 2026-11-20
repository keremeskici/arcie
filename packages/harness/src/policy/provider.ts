import type { AgentLimits } from "@arcie/core";
import type { DbOrTx } from "@arcie/db";

/** Source of a user's agent limits. DB now; ENS text records later (spec §14.2). */
export interface PolicyProvider {
  /** Reads through `tx` when given, so a caller holding the user's budget lock sees limits consistent with it. */
  getLimits(userId: string, tx?: DbOrTx): Promise<AgentLimits & { source: "db" | "ens" }>;
}
