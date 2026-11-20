import { ArcieError, type Channel } from "@arcie/core";
import type { Intent } from "./repo.js";

/**
 * Throws unless `intent` may be confirmed right now (spec §8.3).
 * Pure: the caller performs the actual compare-and-set transition.
 */
export function assertConfirmable(intent: Intent | null, ctx: { channel: Channel; userTurn: number; now: Date }): asserts intent is Intent {
  if (!intent) throw new ArcieError("NOT_FOUND", { spoken: "There's nothing waiting for your confirmation right now." });

  switch (intent.status) {
    case "awaiting_confirmation":
      break;
    case "expired":
      throw new ArcieError("QUOTE_EXPIRED", { detail: { intentId: intent.id } });
    case "cancelled":
      throw new ArcieError("NOT_FOUND", {
        spoken: "That request was replaced or cancelled. Want me to set it up again?",
        detail: { intentId: intent.id, reason: intent.statusReason },
      });
    case "rejected":
      throw new ArcieError("NOT_FOUND", {
        spoken: "That request wasn't allowed, so there's nothing to confirm.",
        detail: { intentId: intent.id },
      });
    default:
      throw new ArcieError("NOT_FOUND", {
        spoken: "I've already handled that one.",
        detail: { intentId: intent.id, alreadyHandled: true, status: intent.status },
      });
  }

  if (intent.expiresAt && intent.expiresAt <= ctx.now.toISOString()) {
    throw new ArcieError("QUOTE_EXPIRED", { detail: { intentId: intent.id } });
  }

  // Any agent-driven channel (voice, repl): the model must not confirm its own proposal in the same turn.
  if (ctx.channel !== "screen" && ctx.userTurn <= intent.previewTurn) {
    throw new ArcieError("POLICY_DENIED", {
      spoken: "I need you to say confirm after hearing the details.",
      detail: { intentId: intent.id, previewTurn: intent.previewTurn, userTurn: ctx.userTurn },
    });
  }
}
