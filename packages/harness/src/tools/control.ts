import { z } from "zod";
import type { HarnessApi } from "../harness.js";
import { tool } from "./registry.js";

export function controlTools(h: Pick<HarnessApi, "confirm" | "cancel" | "chooseContact">) {
  return [
    tool({
      name: "choose_contact",
      kind: "control",
      description: "Choose a recipient for the pending contact choice after the user explicitly picks one. Prepares the original send for a separate confirmation. Does not move money.",
      args: z.object({ selection: z.string().trim().min(1).describe("Exact contact name or their position in the displayed list, such as first or second.") }),
      stepLabel: () => "Preparing your send",
      run: (ctx, a) => h.chooseContact(ctx, a.selection),
    }),
    tool({
      name: "confirm_intent",
      kind: "control",
      description:
        "Execute the pending request ONLY right after the user clearly said yes/confirm to the details you just read out. Omit id to confirm the open request.",
      args: z.object({ id: z.string().optional() }),
      stepLabel: () => "Confirming",
      run: async (ctx, a) => {
        const r = await h.confirm(ctx, a.id, ctx.channel);
        return { summary: r.summary, data: { status: r.status }, ...(r.island ? { island: r.island } : {}) };
      },
    }),
    tool({
      name: "cancel_intent",
      kind: "control",
      description: "Cancel the pending request or contact choice when the user says no, stop or cancel. Omit id to cancel the open request.",
      args: z.object({ id: z.string().optional() }),
      stepLabel: () => "Cancelling",
      run: (ctx, a) => h.cancel(ctx, a.id),
    }),
  ];
}
