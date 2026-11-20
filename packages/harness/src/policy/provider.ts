import type { AgentLimits } from "@arcie/core";

/** Source of a user's agent limits. DB now; ENS text records later (spec §14.2). */
export interface PolicyProvider {
  getLimits(userId: string): Promise<AgentLimits & { source: "db" | "ens" }>;
}
