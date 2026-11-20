import { getAddress } from "viem";
import { getWallet, HOME_CHAIN, readSavings } from "@arcie/appkit";
import { ArcieError } from "@arcie/core";
import { audit, sessions, users, wallets } from "@arcie/db";
import { DbPolicyProvider, quoteSendMax, readWalletBalances } from "@arcie/harness";
import { and, desc, eq, like, or } from "drizzle-orm";
import { Hono } from "hono";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { z } from "zod";
import type { AppDeps } from "../app.js";
import { screenCtx } from "./http.js";

const swapQuoteBody = z.object({
  tokenIn: z.enum(["USDC", "EURC", "cirBTC"]),
  tokenOut: z.enum(["USDC", "EURC", "cirBTC"]),
  amountIn: z.string().min(1),
  maxSlippageBps: z.number().int().min(0).max(10_000).optional(),
});
const activitySummary: Record<string, string> = {
  "intent.proposed": "Ready for your confirmation.",
  "intent.confirmed": "Confirmation received; processing the transaction.",
  "intent.succeeded": "Transaction completed.",
  "intent.failed": "The transaction did not complete. Check its receipt for details.",
  "intent.uncertain": "The transaction could not be verified. Check its status before trying again.",
  "intent.pending": "The transaction is still processing.",
  "intent.rejected": "The request was not allowed.",
  "intent.cancelled": "The request was cancelled.",
  "intent.requoted": "The quote changed; please check the updated details.",
  "onramp.submitted": "Add-money request submitted.",
  "onramp.settled": "Checkout reported a payment update. Check your wallet balance for received funds.",
  "onramp.failed": "Add-money payment did not complete.",
};

export function meRoutes(deps: AppDeps) {
  const app = new Hono();

  app.get("/config", (c) =>
    c.json({
      authMode: deps.authMode,
      demoUserId: deps.demoUserId,
      privyAppId: deps.privyAppId ?? null,
      elevenLabsAgentId: deps.elevenLabsAgentId ?? null,
    }),
  );

  app.get("/me", async (c) => {
    const { userId } = await deps.identify(c);
    const user = deps.db.select().from(users).where(eq(users.id, userId)).get();
    if (!user) throw new ArcieError("NOT_FOUND", { spoken: "I don't know this account yet." });
    const ws = deps.db.select().from(wallets).where(eq(wallets.userId, userId)).all();
    const limits = await new DbPolicyProvider(deps.db).getLimits(userId);
    return c.json({ user, wallets: ws.map((w) => ({ chain: w.chain, address: getAddress(w.address) })), limits });
  });

  app.get("/balances", async (c) => {
    const { userId } = await deps.identify(c);
    const w = await getWallet(deps.db, userId, HOME_CHAIN);
    if (!w) throw new ArcieError("NOT_FOUND", { spoken: "Your wallet isn't set up yet." });
    const { tokens, totalUsd, knownSubtotalUsd } = await readWalletBalances(deps.kit, w, deps.tokenUsdPrice);
    return c.json({ chains: [{ chain: w.chain, tokens }], totalUsd, knownSubtotalUsd });
  });

  app.get("/savings", async (c) => {
    const { userId } = await deps.identify(c);
    const wallet = await getWallet(deps.db, userId, HOME_CHAIN);
    if (!wallet) throw new ArcieError("NOT_FOUND", { spoken: "Your wallet isn't set up yet." });
    return c.json(await readSavings(deps.kit, wallet));
  });

  app.get("/vaults", async (c) => {
    const { userId } = await deps.identify(c);
    const w = await getWallet(deps.db, userId, HOME_CHAIN);
    const vaults = (await deps.kit.listVaults(HOME_CHAIN)).sort((x, y) => y.apy - x.apy);
    const positions = w
      ? (await Promise.all(vaults.map(async (v) => ({ v, p: await deps.kit.getPosition(w, v.address) }))))
          .filter((x) => x.p)
          .map(({ v, p }) => ({ vault: v.address, token: v.token, ...p! }))
      : [];
    return c.json({ vaults, positions });
  });

  app.get("/quotes/send-max", async (c) => {
    const ctx = await screenCtx(deps, c);
    const to = c.req.query("to")?.trim();
    const token = z.enum(["USDC", "EURC", "cirBTC"]).safeParse(c.req.query("token"));
    if (!token.success) return c.json({ error: { code: "INVALID_ARGS", message: "Choose a wallet currency." } }, 400);
    c.header("Cache-Control", "no-store");
    return c.json(await quoteSendMax(deps, ctx, to, token.data));
  });

  app.post("/quotes/swap", async (c) => {
    const parsed = swapQuoteBody.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: { code: "INVALID_ARGS", message: "Invalid swap quote arguments." } }, 400);
    const ctx = await screenCtx(deps, c);
    return c.json(await deps.harness.quoteSwap(ctx, parsed.data));
  });

  app.post("/receive", async (c) => {
    const ctx = await screenCtx(deps, c);
    const r = await deps.harness.runTool({ ...ctx, receiveResponseOnly: c.req.query("delivery") === "response" }, "get_receive_info", {});
    const err = (r.data as { error?: string } | undefined)?.error;
    if (err) return c.json({ error: { code: err, message: r.summary } }, 400);
    return c.json({ summary: r.summary, island: r.island, data: r.data });
  });

  app.post("/chat", async (c) => {
    const ctx = await screenCtx(deps, c);
    const body = (await c.req.json().catch(() => ({}))) as { messages?: ChatCompletionMessageParam[] };
    const messages = Array.isArray(body.messages) ? body.messages : [];
    const incomingTurn = messages.filter((m) => m.role === "user").length;
    const stored = deps.db.select().from(sessions).where(eq(sessions.id, ctx.sessionId)).get();
    const userTurn = Math.max(incomingTurn, stored?.userTurn ?? 0);
    deps.db
      .insert(sessions)
      .values({ id: ctx.sessionId, userId: ctx.userId, channel: "repl", userTurn })
      .onConflictDoUpdate({ target: sessions.id, set: { userTurn, channel: "repl" } })
      .run();
    let reply = "";
    for await (const s of deps.agent({ ...ctx, channel: "repl", userTurn }, messages)) reply += s;
    return c.json({ reply, sessionId: ctx.sessionId, userTurn });
  });

  app.get("/activity", async (c) => {
    const { userId } = await deps.identify(c);
    const rows = deps.db
      .select({ at: audit.createdAt, type: audit.type, intentId: audit.intentId })
      .from(audit)
      .where(and(eq(audit.userId, userId), or(like(audit.type, "intent.%"), like(audit.type, "onramp.%"))))
      .orderBy(desc(audit.id))
      .limit(50)
      .all();
    const items = rows.map((row) => ({ ...row, summary: activitySummary[row.type] ?? "Account activity updated." }));
    return c.json({ items });
  });

  return app;
}
