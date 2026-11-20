import { ArcieError, type ActionKind } from "@arcie/core";
import { audit, intents, type IntentStatus } from "@arcie/db";
import { and, desc, eq, inArray } from "drizzle-orm";
import type { HarnessCtx } from "../context.js";
import type { Intent } from "../intents/repo.js";
import type { Svc } from "../services.js";

const actionName = {
  send: "send", swap: "swap", earn_deposit: "savings deposit", earn_withdraw: "savings withdrawal",
} satisfies Record<ActionKind, string>;

function intentStatus(intent: Intent, now: Date): IntentStatus {
  return intent.status === "awaiting_confirmation" && intent.expiresAt && intent.expiresAt <= now.toISOString()
    ? "expired" : intent.status;
}

function reportedStatus(intent: Intent, status: IntentStatus, ctx: HarnessCtx) {
  return ctx.channel === "voice" && intent.statusReason === "submission_unknown" ? "unverified" : status;
}

function describeIntent(intent: Intent, status: IntentStatus, ctx: HarnessCtx): string {
  const name = actionName[intent.kind];
  if (intent.statusReason === "submission_unknown") return `I couldn't verify your ${name}. Check Activity before trying again.`;
  switch (status) {
    case "validating": return `Your ${name} is being checked.`;
    case "rejected": return `Your ${name} couldn't be prepared.`;
    case "awaiting_confirmation": return intent.sessionId === ctx.sessionId
      ? `Your ${name} is waiting for your confirmation.`
      : `Your ${name} needs confirmation where you started it.`;
    case "expired": return `Your ${name} request expired. Ask for a new one.`;
    case "cancelled": return `Your ${name} was cancelled.`;
    case "executing": return `Your ${name} is still processing.`;
    case "succeeded": return `Your ${name} completed.`;
    case "failed": return `Your ${name} didn't go through.`;
  }
}

const CHECKOUT = {
  "onramp.submitted": { status: "submitted", summary: "Your add-money payment was submitted." },
  "onramp.settled": { status: "checkout_updated", summary: "Checkout reported an update. Check your wallet balance for the funds." },
  "onramp.failed": { status: "failed", summary: "Your add-money payment didn't complete." },
} as const;

export async function readActivity(svc: Svc, ctx: HarnessCtx, limit: number) {
  const now = ctx.now();
  const [transferRows, checkoutRows] = await Promise.all([
    svc.db.select().from(intents).where(eq(intents.userId, ctx.userId))
      .orderBy(desc(intents.updatedAt), desc(intents.createdAt)).limit(limit),
    svc.db.select({ type: audit.type, at: audit.createdAt }).from(audit)
      .where(and(eq(audit.userId, ctx.userId), inArray(audit.type, Object.keys(CHECKOUT))))
      .orderBy(desc(audit.createdAt), desc(audit.id)).limit(limit),
  ]);
  const transfers = transferRows.map((intent) => {
      const status = intentStatus(intent, now);
      const { amount, token, amountIn, tokenIn, tokenOut, recipientLabel } = intent.params;
      return {
        intentId: intent.id, kind: intent.kind, status: reportedStatus(intent, status, ctx), at: intent.updatedAt, txHash: intent.txHash, statusReason: intent.statusReason,
        params: { amount, token, amountIn, tokenIn, tokenOut, recipientLabel }, summary: describeIntent(intent, status, ctx),
      };
    });
  const checkouts = checkoutRows.map((event) => ({
      kind: "onramp" as const, at: event.at, ...CHECKOUT[event.type as keyof typeof CHECKOUT],
    }));
  const items = [...transfers, ...checkouts].sort((a, b) => b.at.localeCompare(a.at)).slice(0, limit);
  return { summary: items[0]?.summary ?? "No activity yet.", data: { items } };
}

export async function readIntent(svc: Svc, ctx: HarnessCtx, args: { id?: string | undefined; kind?: ActionKind | undefined }) {
  const userScope = and(eq(intents.userId, ctx.userId), args.kind ? eq(intents.kind, args.kind) : undefined);
  const latest = async (sessionId?: string) => (await svc.db.select().from(intents)
    .where(and(userScope, sessionId ? eq(intents.sessionId, sessionId) : undefined))
    .orderBy(desc(intents.createdAt), desc(intents.updatedAt)).limit(1))[0];
  const record = args.id ? await svc.repo.get(args.id) : await latest(ctx.sessionId) ?? await latest();
  if (record && record.userId === ctx.userId && (!args.kind || args.kind === record.kind)) {
    const intent = await svc.refreshIntentStatus?.(record) ?? record;
    const status = intentStatus(intent, ctx.now());
    return { summary: describeIntent(intent, status, ctx), data: { id: intent.id, kind: intent.kind, status: reportedStatus(intent, status, ctx), txHash: intent.txHash, statusReason: intent.statusReason } };
  }
  if (args.id) throw new ArcieError("NOT_FOUND", { spoken: "I couldn't find that transaction." });
  const name = args.kind ? actionName[args.kind] : "transaction";
  return { summary: `I couldn't find a recent ${name}.`, data: { status: null } };
}
