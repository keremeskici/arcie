import { getWallet, HOME_CHAIN } from "@arcie/appkit";
import { ArcieError, type TokenSymbol } from "@arcie/core";
import { audit, sessions, users, wallets } from "@arcie/db";
import { DbPolicyProvider } from "@arcie/harness";
import { desc, eq } from "drizzle-orm";
import { Hono } from "hono";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { z } from "zod";
import type { AppDeps } from "../app.js";
import { screenCtx } from "./http.js";

const round2 = (n: number) => Math.round(n * 100) / 100;
const swapQuoteBody = z.object({
  tokenIn: z.enum(["USDC", "EURC", "cirBTC"]),
  tokenOut: z.enum(["USDC", "EURC", "cirBTC"]),
  amountIn: z.string().min(1),
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
    return c.json({ user, wallets: ws.map((w) => ({ chain: w.chain, address: w.address })), limits });
  });

  app.get("/balances", async (c) => {
    const { userId } = await deps.identify(c);
    const w = await getWallet(deps.db, userId, HOME_CHAIN);
    if (!w) throw new ArcieError("NOT_FOUND", { spoken: "Your wallet isn't set up yet." });
    const balances = await deps.kit.getBalances(w);
    const tokens = await Promise.all(
      balances.map(async (b) => {
        if (Number(b.amount) === 0) return { ...b, usd: 0 };
        const rate = await deps.kit
          .getUsdRates(w.chain, [b.token as TokenSymbol])
          .then((r) => r[b.token as TokenSymbol])
          .catch(() => null);
        return { ...b, usd: rate === null || !Number.isFinite(rate) ? null : round2(Number(b.amount) * rate) };
      }),
    );
    const knownSubtotalUsd = round2(tokens.reduce((s, t) => s + (t.usd ?? 0), 0));
    const totalUsd = tokens.some((t) => t.usd === null) ? null : knownSubtotalUsd;
    return c.json({ chains: [{ chain: w.chain, tokens }], totalUsd, knownSubtotalUsd });
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

  app.post("/quotes/swap", async (c) => {
    const parsed = swapQuoteBody.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: { code: "INVALID_ARGS", message: "Invalid swap quote arguments." } }, 400);
    const ctx = await screenCtx(deps, c);
    const r = await deps.harness.runTool(ctx, "get_swap_quote", parsed.data);
    const err = (r.data as { error?: string } | undefined)?.error;
    if (err) return c.json({ error: { code: err, message: r.summary } }, 400);
    return c.json({ summary: r.summary, data: r.data });
  });

  app.post("/receive", async (c) => {
    const ctx = await screenCtx(deps, c);
    const r = await deps.harness.runTool(ctx, "get_receive_info", {});
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
    const rows = deps.db.select().from(audit).where(eq(audit.userId, userId)).orderBy(desc(audit.id)).limit(50).all();
    const items = rows
      .filter((r) => r.type.startsWith("intent.") || r.type.startsWith("onramp."))
      .map((r) => ({
        at: r.createdAt,
        type: r.type,
        intentId: r.intentId,
        // Audit payloads contain internal diagnostics and are never an API contract.
        summary: activitySummary[r.type] ?? "Account activity updated.",
      }));
    return c.json({ items });
  });

  return app;
}
