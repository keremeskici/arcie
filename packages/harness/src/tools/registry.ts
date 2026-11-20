import type { IslandPayload } from "@arcie/core";
import type { z } from "zod";
import type { HarnessCtx } from "../context.js";

export type ToolResult = { summary: string; data: unknown; island?: IslandPayload };

export interface ToolDef<A = unknown> {
  name: string;
  /** read: no side effects · propose: creates an intent · control: confirm/cancel · action: non-intent side effect (onramp). */
  kind: "read" | "propose" | "control" | "action";
  description: string;
  args: z.ZodType<A>;
  /** Plain-language label for the Steps island. */
  stepLabel: (a: A) => string;
  run: (ctx: HarnessCtx, a: A) => Promise<ToolResult>;
}

export function tool<A>(def: ToolDef<A>): ToolDef<A> {
  return def;
}
