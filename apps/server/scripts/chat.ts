/**
 * pnpm chat: talk to the running server (`pnpm dev`) from the terminal, as the "repl" channel.
 * Keeps the conversation history like ElevenLabs does and prints island events from /events when available.
 */
import { createInterface } from "node:readline/promises";

const base = process.env.ARCIE_URL ?? `http://localhost:${process.env.PORT ?? 8787}`;
const sessionId = process.env.ARCIE_SESSION ?? `repl-${Date.now()}`;
const messages: { role: "user" | "assistant"; content: string }[] = [];

async function followEvents() {
  try {
    const res = await fetch(`${base}/events?sessionId=${encodeURIComponent(sessionId)}`);
    if (!res.ok || !res.body) return;
    const decoder = new TextDecoder();
    let buf = "";
    for await (const chunk of res.body) {
      buf += decoder.decode(chunk as Uint8Array, { stream: true });
      let i;
      while ((i = buf.indexOf("\n\n")) >= 0) {
        const frame = buf.slice(0, i);
        buf = buf.slice(i + 2);
        const data = frame.split("\n").find((l) => l.startsWith("data: "))?.slice(6);
        if (!data || !frame.includes("event: island")) continue;
        const island = JSON.parse(data) as { kind: string; [k: string]: unknown };
        if (island.kind === "steps") continue;
        const { kind, ...rest } = island;
        console.log(`\n  [${kind}] ${JSON.stringify(rest).slice(0, 400)}`);
      }
    }
  } catch {
    // events are optional for the REPL
  }
}

void followEvents();
const rl = createInterface({ input: process.stdin, output: process.stdout });
console.log(`Arcie REPL → ${base} (session ${sessionId}). Ctrl+C to quit.`);
while (true) {
  const say = (await rl.question("\nyou › ")).trim();
  if (!say) continue;
  messages.push({ role: "user", content: say });
  const res = await fetch(`${base}/v1/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(process.env.LLM_SHARED_SECRET ? { authorization: `Bearer ${process.env.LLM_SHARED_SECRET}` } : {}),
    },
    body: JSON.stringify({ messages, session_id: sessionId, arcie_channel: "repl" }),
  });
  const body = (await res.json()) as { choices?: { message: { content: string } }[]; error?: { message: string } };
  const reply = body.choices?.[0]?.message.content ?? `(error: ${body.error?.message ?? res.status})`;
  messages.push({ role: "assistant", content: reply });
  console.log(`arcie › ${reply}`);
}
