import type { HarnessCtx, Harness, ToolDef } from "@arcie/harness";
import type { ChatCompletionMessageParam, ChatCompletionTool } from "openai/resources/chat/completions";
import { z } from "zod";
import { SYSTEM_PROMPT } from "./prompt.js";

const MAX_TOOL_CALLS = 6;
const TIMEOUT_MS = 15_000;
export const FALLBACK = "Sorry, I couldn't do that just now. Can you say it again?";
export const TOO_MANY_STEPS = "Sorry, that took too many steps. Could you say it more simply?";

type Chunk = {
  choices: {
    index?: number;
    delta: { content?: string | null; tool_calls?: { index: number; id?: string; function?: { name?: string; arguments?: string } }[] };
    finish_reason?: string | null;
  }[];
};

/** The slice of the OpenAI client we use (lets tests script it). */
export interface ChatClient {
  chat: { completions: { create(body: any, opts?: { signal?: AbortSignal; timeout?: number }): Promise<AsyncIterable<Chunk>> } };
}

export interface AgentDeps {
  openai: ChatClient;
  model: string;
  reasoningEffort?: string | undefined;
  harness: Pick<Harness, "tools" | "runTool">;
}

export function toOpenAITools(tools: ToolDef<any>[]): ChatCompletionTool[] {
  return tools.map((t) => ({
    type: "function",
    function: { name: t.name, description: t.description, parameters: z.toJSONSchema(t.args, { io: "input" }) as Record<string, unknown> },
  }));
}

/**
 * One agent turn: streams the model, runs requested tools through the harness, and yields spoken text.
 * Tool rounds and the final answer use the same streamed call; text deltas are yielded as they arrive.
 */
export async function* runAgentTurn(
  deps: AgentDeps,
  ctx: HarnessCtx,
  incoming: ChatCompletionMessageParam[],
  signal?: AbortSignal,
): AsyncGenerator<string> {
  const messages: ChatCompletionMessageParam[] = [
    { role: "system", content: SYSTEM_PROMPT },
    ...incoming.filter((m) => m.role !== "system" && m.role !== "developer"),
  ];
  const tools = toOpenAITools(deps.harness.tools);
  let toolCalls = 0;

  while (true) {
    if (signal?.aborted) return;
    if (toolCalls >= MAX_TOOL_CALLS) {
      yield TOO_MANY_STEPS;
      return;
    }

    const calls: { id: string; name: string; args: string }[] = [];
    let spoke = false;
    try {
      const stream = await deps.openai.chat.completions.create(
        {
          model: deps.model,
          messages,
          tools,
          stream: true,
          ...(deps.reasoningEffort ? { reasoning_effort: deps.reasoningEffort } : {}),
        },
        { ...(signal ? { signal } : {}), timeout: TIMEOUT_MS },
      );
      for await (const chunk of stream) {
        if (signal?.aborted) return;
        const delta = chunk.choices[0]?.delta;
        if (!delta) continue;
        if (delta.content) {
          spoke = true;
          yield delta.content;
        }
        for (const tc of delta.tool_calls ?? []) {
          const c = (calls[tc.index] ??= { id: "", name: "", args: "" });
          if (tc.id) c.id = tc.id;
          if (tc.function?.name) c.name += tc.function.name;
          if (tc.function?.arguments) c.args += tc.function.arguments;
        }
      }
    } catch {
      if (signal?.aborted) return;
      if (!spoke) yield FALLBACK;
      return;
    }

    if (!calls.length) return;
    messages.push({
      role: "assistant",
      content: null,
      tool_calls: calls.map((c) => ({ id: c.id, type: "function", function: { name: c.name, arguments: c.args || "{}" } })),
    });

    for (const c of calls) {
      if (signal?.aborted) return;
      if (toolCalls >= MAX_TOOL_CALLS) {
        messages.push({ role: "tool", tool_call_id: c.id, content: JSON.stringify({ summary: "Skipped: too many steps." }) });
        continue;
      }
      toolCalls++;
      let args: unknown = {};
      try {
        args = c.args ? JSON.parse(c.args) : {};
      } catch {
        args = {};
      }
      const r = await deps.harness.runTool(signal ? { ...ctx, signal } : ctx, c.name, args);
      messages.push({ role: "tool", tool_call_id: c.id, content: JSON.stringify({ summary: r.summary, data: r.data }) });
    }
  }
}
