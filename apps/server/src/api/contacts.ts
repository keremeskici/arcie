import { contacts } from "@arcie/db";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { randomUUID } from "node:crypto";
import { getAddress, isAddress } from "viem";
import { z } from "zod";
import type { AppDeps } from "../app.js";
import { screenCtx } from "./http.js";

const contactBody = z.object({ name: z.string().trim().min(1).max(60), address: z.string() });

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
    if (!parsed.success || !isAddress(parsed.data.address, { strict: true }) || getAddress(parsed.data.address) !== parsed.data.address) {
      return c.json({ error: { code: "INVALID_RECIPIENT", message: "That name or address doesn't look right." } }, 400);
    }
    const row = { id: randomUUID(), userId, name: parsed.data.name, address: getAddress(parsed.data.address), chain: "Arc_Testnet" as const };
    const inserted = await deps.db.insert(contacts).values(row).onConflictDoNothing().returning({ id: contacts.id });
    if (inserted.length === 0) return c.json({ error: { code: "INVALID_RECIPIENT", message: "You already have a contact with that name." } }, 400);
    return c.json({ contact: row });
  });

  app.post("/choices/:id", async (c) => {
    const ctx = await screenCtx(deps, c);
    const body = (await c.req.json().catch(() => ({}))) as { optionId?: string };
    await deps.harness.answerChoice(ctx, c.req.param("id"), String(body.optionId ?? ""));
    return c.json({ ok: true });
  });

  return app;
}
