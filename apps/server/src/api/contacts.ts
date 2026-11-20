import { contacts } from "@arcie/db";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { randomUUID } from "node:crypto";
import { getAddress, isAddress } from "viem";
import { z } from "zod";
import type { AppDeps } from "../create-app.js";
import { screenCtx } from "./http.js";

const contactBody = z.object({
  name: z.string().trim().min(1).max(60),
  address: z.string().refine((value) => isAddress(value, { strict: true }) && getAddress(value) === value),
});

export function contactRoutes(deps: AppDeps) {
  const app = new Hono();

  app.get("/contacts", async (c) => {
    const { userId } = await deps.identify(c);
    const rows = await deps.db.select().from(contacts).where(eq(contacts.userId, userId));
    return c.json({ contacts: rows.map((r) => ({ id: r.id, name: r.name, address: r.address, chain: r.chain })) });
  });

  app.post("/contacts", async (c) => {
    const { userId } = await deps.identify(c);
    const parsed = contactBody.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      const message = parsed.error.issues[0]?.path[0] === "address"
        ? "Paste the full checksummed wallet address with its original capitalization."
        : "Enter a contact name between 1 and 60 characters.";
      return c.json({ error: { code: "INVALID_RECIPIENT", message } }, 400);
    }
    const row = { id: randomUUID(), userId, name: parsed.data.name, address: getAddress(parsed.data.address), chain: "Arc_Testnet" as const };
    const inserted = await deps.db.insert(contacts).values(row).onConflictDoNothing().returning({ id: contacts.id });
    if (inserted.length === 0) return c.json({ error: { code: "INVALID_RECIPIENT", message: "You already have a contact with that name." } }, 400);
    return c.json({ contact: row });
  });

  app.post("/choices/:id", async (c) => {
    const ctx = await screenCtx(deps, c);
    const body = (await c.req.json().catch(() => null)) as { optionId?: string; prepare?: boolean } | null;
    const optionId = String(body?.optionId ?? "");
    if (body?.prepare === true) {
      const result = await deps.harness.prepareChoice(ctx, c.req.param("id"), optionId);
      if (result.island?.kind !== "confirm") {
        const data = result.data as { error?: string; cancelled?: boolean } | undefined;
        return c.json({ error: { code: data?.error ?? "NOT_FOUND", message: result.summary } }, data?.cancelled ? 409 : 400);
      }
      return c.json({ ok: true, summary: result.summary, island: result.island });
    }
    await deps.harness.answerChoice(ctx, c.req.param("id"), optionId);
    return c.json({ ok: true });
  });

  app.delete("/choices/:id", async (c) => {
    const ctx = await screenCtx(deps, c);
    await deps.harness.dismissChoice(ctx, c.req.param("id"));
    return c.json({ ok: true });
  });

  return app;
}
