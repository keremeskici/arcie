import { ArcieError, type ChoiceIsland } from "@arcie/core";
import { choices, type Db } from "@arcie/db";
import { and, desc, eq, gt, isNull } from "drizzle-orm";
import type { HarnessCtx } from "./context.js";

export function activeContactChoice(db: Db, sessionId: string, now: Date, userId?: string) {
  return db.select().from(choices).where(and(
    eq(choices.sessionId, sessionId),
    userId === undefined ? undefined : eq(choices.userId, userId),
    isNull(choices.closedAt), isNull(choices.selectedOptionId), gt(choices.expiresAt, now.toISOString()),
  )).orderBy(desc(choices.createdAt)).limit(1).get();
}

export function contactChoiceIsland(row: typeof choices.$inferSelect): ChoiceIsland {
  return {
    kind: "choice", choiceId: row.id, question: row.question, options: row.options,
    ...(row.send ? { send: row.send } : {}),
    ...(row.expiresAt ? { expiresAt: row.expiresAt } : {}),
  };
}

export function closeContactChoice(db: Db, ctx: HarnessCtx, id: string, selectedOptionId?: string) {
  return db.update(choices).set({ closedAt: ctx.now().toISOString(), ...(selectedOptionId ? { selectedOptionId } : {}) })
    .where(and(eq(choices.id, id), eq(choices.sessionId, ctx.sessionId), eq(choices.userId, ctx.userId), isNull(choices.closedAt)))
    .run().changes === 1;
}

const ordinals = ["first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth", "ninth", "tenth"];

export function matchContactChoice(options: ChoiceIsland["options"], selection: string) {
  const name = selection.trim().toLowerCase();
  const exact = options.filter((option) => option.label.trim().toLowerCase() === name);
  if (exact.length === 1) return exact[0];
  const numeric = /^(?:option )?(\d+)(?:st|nd|rd|th)?$/.exec(name);
  const index = numeric ? Number(numeric[1]) - 1 : ordinals.indexOf(name.replace(/^the /, "").replace(/ one$/, ""));
  return options[index];
}

export const noContactChoice = () => new ArcieError("NOT_FOUND", { spoken: "That contact choice is no longer open. Ask me to set up the send again." });
