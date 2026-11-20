import { IconArrowUp, IconX } from "@tabler/icons-react";
import * as React from "react";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { VoiceButton } from "@/lib/voice-access";

type Message = { role: "assistant" | "user"; content: string };

export function ChatScreen({ open, onClose, draft, setDraft }: {
  open: boolean;
  onClose: () => void;
  draft: string;
  setDraft: (value: string) => void;
}) {
  const [messages, setMessages] = React.useState<Message[]>([]);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const log = React.useRef<HTMLDivElement>(null);
  const sending = React.useRef(false);
  React.useEffect(() => {
    if (open && log.current) log.current.scrollTop = log.current.scrollHeight;
  }, [messages, open, busy]);

  async function send(event: React.FormEvent) {
    event.preventDefault();
    const content = draft.trim();
    if (!content || sending.current) return;
    const history: Message[] = [...messages, { role: "user", content }];
    sending.current = true;
    setMessages(history);
    setDraft("");
    setError(null);
    setBusy(true);
    try {
      const { reply } = await api.post<{ reply: string }>("/chat", { messages: history });
      if (!reply.trim()) throw new Error("Arcie returned an empty reply.");
      setMessages([...history, { role: "assistant", content: reply }]);
    } catch (err) {
      setMessages(messages);
      setDraft(content);
      setError(err instanceof Error ? err.message : "Couldn’t send your message.");
    } finally {
      sending.current = false;
      setBusy(false);
    }
  }

  if (!open) return null;
  return (
    <section aria-label="Chat with Arcie" className="fixed inset-0 z-50 mx-auto flex max-w-[430px] flex-col bg-bg px-5 pb-[max(1rem,env(safe-area-inset-bottom))] pt-[max(1rem,env(safe-area-inset-top))]">
      <header className="flex items-center justify-between border-b border-line pb-3">
        <h2 className="text-lg font-semibold">Chat with Arcie</h2>
        <div className="flex items-center gap-1">
          <VoiceButton />
          <button className="grid size-10 place-items-center rounded-full bg-card" aria-label="Close chat" onClick={onClose}><IconX size={18} /></button>
        </div>
      </header>
      <div ref={log} role="log" aria-label="Conversation" className="flex-1 space-y-3 overflow-y-auto py-4">
        {!messages.length && <p className="text-sm text-muted">Ask about your wallet or request a transaction.</p>}
        {messages.map((message, index) => <p key={index} className={cn("w-fit max-w-[90%] whitespace-pre-wrap break-words rounded-2xl px-4 py-3 text-sm", message.role === "user" ? "ml-auto bg-accent/20" : "bg-card")}>
          <span className="sr-only">{message.role === "user" ? "You" : "Arcie"}. </span>{message.content}
        </p>)}
        {busy && <p role="status" className="text-sm text-muted">Arcie is thinking…</p>}
      </div>
      {error && <p role="alert" className="pb-2 text-sm text-danger">{error}</p>}
      <form onSubmit={send} className="flex items-center gap-2 rounded-2xl border border-line bg-card p-2">
        <input aria-label="Message" placeholder="Message Arcie…" value={draft} autoFocus disabled={busy}
          onChange={e => setDraft(e.target.value)} className="min-w-0 flex-1 bg-transparent px-2 py-2 outline-none" />
        <button aria-label="Send message" disabled={busy || !draft.trim()} className="grid size-10 place-items-center rounded-xl bg-accent text-white disabled:opacity-40"><IconArrowUp size={19}/></button>
      </form>
    </section>
  );
}
