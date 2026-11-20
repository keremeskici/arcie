import type { Channel } from "@arcie/core";
import { sessions, users, type Db } from "@arcie/db";
import type { HarnessCtx } from "@arcie/harness";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { stream } from "hono/streaming";
import { randomUUID, timingSafeEqual } from "node:crypto";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { admitTurn, resolveVoiceSession, type AuthMode } from "../auth/identify.js";

export type AgentFn = (ctx: HarnessCtx, messages: ChatCompletionMessageParam[], signal?: AbortSignal) => AsyncGenerator<string>;

interface ChatBody {
  model?: string;
  stream?: boolean;
  messages?: ChatCompletionMessageParam[];
  user_id?: string;
  session_id?: string;
  arcie_conversation_id?: string;
  arcie_channel?: Channel;
  elevenlabs_extra_body?: { user_id?: string; session_id?: string; arcie_conversation_id?: string };
}

/**
 * OpenAI-compatible endpoint used by ElevenLabs as a custom LLM (spec §7) and by the REPL.
 * Identity: body.user_id → elevenlabs_extra_body.user_id → x-arcie-user header → demo user.
 */
export function chatRoutes(deps: { db: Db; agent: AgentFn; demoUserId: string; model: string; authMode?: AuthMode; llmSecret?: string | undefined }) {
  const app = new Hono();
  const inflight = new Map<string, AbortController>();

  app.post("/v1/chat/completions", async (c) => {
    // ElevenLabs sends this as a fixed custom-LLM request header; it keeps strangers off the OpenAI bill.
    if (deps.llmSecret && !timingSafeEqualStr(c.req.header("authorization") ?? "", `Bearer ${deps.llmSecret}`)) {
      return c.json({ error: { message: "Missing or wrong LLM secret.", type: "invalid_request_error", code: "UNAUTHENTICATED" } }, 401);
    }
    const body = ((await c.req.json().catch(() => null)) ?? {}) as ChatBody;
    const messages = Array.isArray(body.messages) ? body.messages : [];
    if (process.env.LOG_LLM_REQUESTS) {
      console.log("[llm] request received", { messageCount: messages.length });
    }
    const extra = body.elevenlabs_extra_body;
    const requestedSession = body.session_id ?? extra?.session_id ?? c.req.header("x-arcie-session");
    const conversationId = body.arcie_conversation_id ?? extra?.arcie_conversation_id ?? null;
    let userId: string;
    let sessionId: string;
    let stored: typeof sessions.$inferSelect | undefined;
    if (deps.authMode === "privy") {
      // The request comes from ElevenLabs' servers: trust only the user-bound voice session, never user_id in the body.
      const bound = await resolveVoiceSession(deps.db, requestedSession);
      if (!bound) return c.json({ error: { message: "Unknown or expired voice session.", type: "invalid_request_error", code: "UNAUTHENTICATED" } }, 401);
      userId = bound.userId;
      sessionId = requestedSession!;
      stored = bound;
    } else {
      userId = body.user_id ?? extra?.user_id ?? c.req.header("x-arcie-user") ?? deps.demoUserId;
      if (!(await deps.db.select().from(users).where(eq(users.id, userId)).limit(1))[0]) {
        return c.json({ error: { message: `Unknown user ${userId}`, type: "invalid_request_error" } }, 404);
      }
      sessionId = requestedSession ?? `default:${userId}`;
      [stored] = await deps.db.select().from(sessions).where(eq(sessions.id, sessionId)).limit(1);
      if (stored && stored.userId !== userId) {
        return c.json({ error: { message: "This session belongs to another user.", type: "invalid_request_error", code: "UNAUTHENTICATED" } }, 401);
      }
    }
    const channel: Channel = body.arcie_channel === "repl" ? "repl" : "voice";

    const staleConversation = () =>
      c.json({ error: { message: "That voice conversation was replaced. Reopen voice to continue.", type: "invalid_request_error", code: "STALE_CONVERSATION" } }, 409);
    if (channel === "voice" && conversationId !== (stored?.conversationId ?? null)) return staleConversation();
    const incoming = messages.filter((m) => m?.role === "user").length;
    const userTurn = incoming + (channel === "voice" ? stored?.conversationStartTurn ?? 0 : 0);
    const accepted = incoming > 0 && await admitTurn(deps.db, sessionId, userId, channel, userTurn, {
      existing: deps.authMode === "privy" || conversationId !== null,
      ...(channel === "voice" ? { conversationId } : {}),
    });
    if (incoming > 0 && !accepted && stored && channel === "voice") {
      // The binding may have changed between the lookup and the compare-and-set.
      const [current] = await deps.db.select({ conversationId: sessions.conversationId })
        .from(sessions).where(eq(sessions.id, sessionId)).limit(1);
      if (current && current.conversationId !== conversationId) return staleConversation();
    }
    const ac = new AbortController();
    if (accepted) {
      inflight.get(sessionId)?.abort();
      inflight.set(sessionId, ac);
    }
    const done = () => inflight.get(sessionId) === ac && inflight.delete(sessionId);

    const runId = randomUUID();
    const ctx: HarnessCtx = { userId, sessionId, channel, userTurn, sessionGuard: "turn", now: () => new Date(), runId };
    const gen = accepted ? deps.agent(ctx, messages, ac.signal) : [];
    const id = `chatcmpl-${runId}`;
    const created = Math.floor(Date.now() / 1000);
    const model = body.model ?? deps.model;

    if (!body.stream) {
      let content = "";
      try {
        for await (const s of gen) content += s;
      } finally {
        done();
      }
      return c.json({
        id,
        object: "chat.completion",
        created,
        model,
        choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
      });
    }

    c.header("Content-Type", "text/event-stream");
    c.header("Cache-Control", "no-cache");
    c.header("Connection", "keep-alive");
    return stream(c, async (s) => {
      const send = (delta: object, finish: string | null = null) =>
        s.write(`data: ${JSON.stringify({ id, object: "chat.completion.chunk", created, model, choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`);
      s.onAbort(() => ac.abort());
      try {
        let first = true;
        for await (const text of gen) {
          await send(first ? { role: "assistant", content: text } : { content: text });
          first = false;
        }
        await send({}, "stop");
        await s.write("data: [DONE]\n\n");
      } catch {
        console.error("Voice stream interrupted");
      } finally {
        done();
      }
    });
  });

  return app;
}

function timingSafeEqualStr(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
