import type { ChoiceIsland, ConfirmIsland, IslandPayload, ReceiptIsland, RichText } from "@arcie/core";
import { useConversationControls, useConversationStatus } from "@elevenlabs/react";
import { IconAlertTriangle, IconCircleCheckFilled, IconCircleXFilled, IconExternalLink, IconInfoCircle } from "@tabler/icons-react";
import * as React from "react";
import { Button } from "@/components/Button";
import { Drawer, DrawerContent } from "@/components/ui/drawer";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { useIslands } from "@/lib/islands";

/**
 * The one place money actions are approved. Confirm cards, receipts and choices arrive over the island
 * stream (from voice or from a tap) and render here. A voice "confirm" and a tap both reach
 * harness.confirm; whichever comes first wins.
 */
export function ActionSheet() {
  const { confirm, receipt, choice, push, clear } = useIslands();
  const voice = useVoiceBridge();
  const [hiddenIntent, setHiddenIntent] = React.useState<string | null>(null);

  const card: "confirm" | "receipt" | "choice" | null = confirm ? "confirm" : receipt ? "receipt" : choice ? "choice" : null;
  const open = card !== null && !(card === "confirm" && hiddenIntent === confirm?.intentId);

  function onOpenChange(o: boolean) {
    if (o) return;
    if (card === "confirm" && confirm) setHiddenIntent(confirm.intentId); // hiding isn't cancelling
    if (card === "receipt") clear("receipt");
    if (card === "choice") clear("choice");
  }

  return (
    <>
      {confirm && hiddenIntent === confirm.intentId ? (
        <button
          onClick={() => setHiddenIntent(null)}
          className="fixed left-1/2 top-[calc(env(safe-area-inset-top)+12px)] z-[60] flex -translate-x-1/2 items-center gap-2 rounded-full border border-accent/40 bg-card-2 px-4 py-2 text-sm shadow-xl"
        >
          <span className="size-2 animate-pulse rounded-full bg-accent" /> Waiting for your OK · Review
        </button>
      ) : null}
      <Drawer open={open} onOpenChange={onOpenChange}>
        <DrawerContent showClose={card !== "confirm"} title={sheetTitle(card)}>
          {card === "confirm" && confirm ? (
            <ConfirmCard key={`${confirm.intentId}:${confirm.revision ?? 0}`} island={confirm} onResult={push} voice={voice} />
          ) : card === "receipt" && receipt ? (
            <ReceiptCard island={receipt} onDone={() => clear("receipt")} voice={voice} />
          ) : card === "choice" && choice ? (
            <ChoiceCard island={choice} onAnswered={() => clear("choice")} voice={voice} />
          ) : null}
        </DrawerContent>
      </Drawer>
    </>
  );
}

const sheetTitle = (c: string | null) => (c === "receipt" ? "Receipt" : c === "choice" ? "Quick question" : "Please confirm");

type VoiceBridge = { live: boolean; tell: (text: string) => void; say: (text: string) => void };

/** Lets on-screen taps keep the live voice conversation in sync (spec §9.3). */
function useVoiceBridge(): VoiceBridge {
  const { status } = useConversationStatus();
  const { sendContextualUpdate, sendUserMessage } = useConversationControls();
  const live = status === "connected";
  return React.useMemo(
    () => ({
      live,
      tell: (t: string) => live && sendContextualUpdate(t),
      say: (t: string) => live && sendUserMessage(t),
    }),
    [live, sendContextualUpdate, sendUserMessage],
  );
}

function Rich({ text }: { text: RichText }) {
  return (
    <p className="text-[15px] leading-relaxed text-fg/85">
      {text.map((s, i) => (s.bold ? <strong key={i} className="font-semibold text-fg">{s.text}</strong> : <span key={i}>{s.text}</span>))}
    </p>
  );
}

function useCountdown(expiresAt: string) {
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const left = Math.max(0, Math.round((new Date(expiresAt).getTime() - now) / 1000));
  return { left, label: `${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}` };
}

function ConfirmCard({ island, onResult, voice }: { island: ConfirmIsland; onResult: (i: IslandPayload) => void; voice: VoiceBridge }) {
  const [busy, setBusy] = React.useState<"confirm" | "cancel" | null>(null);
  const { verify, verifying } = useIslands();
  const [error, setError] = React.useState<string | null>(null);
  const { left, label } = useCountdown(island.expiresAt);
  const expired = left === 0;

  async function act(kind: "confirm" | "cancel") {
    setBusy(kind);
    setError(null);
    try {
      const r = await api.post<{ island?: IslandPayload; summary?: string; status?: string }>(`/intents/${island.intentId}/${kind}`, kind === "confirm" ? { channel: "screen", revision: island.revision } : {});
      if (kind === "cancel" || r.status === "succeeded" || r.status === "executing") voice.tell(r.summary ?? "The action was updated.");
      if (kind === "confirm" && (!r.island || r.status === "executing")) verify(island.intentId);
      setBusy(null);
      if (r.island) onResult(r.island);
      else if (kind === "cancel") onResult({ kind: "dismiss", intentId: island.intentId, reason: "cancelled" });
    } catch (e) {
      if (kind === "confirm") verify(island.intentId);
      setError(e instanceof Error ? e.message : "Checking the status of your request.");
      setBusy(null);
    }
  }

  if (busy === "confirm" || verifying === island.intentId) {
    return (
      <div className="flex flex-col items-center gap-4 py-10">
        <span className="size-12 animate-spin rounded-full border-2 border-white/10 border-t-accent" />
        <p className="text-[15px] font-medium">Checking your transaction…</p>
        <p className="text-sm text-muted">This usually takes a few seconds.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-[22px] font-semibold leading-snug tracking-tight">{island.title}</h2>

      {island.chips.length ? (
        <div className="flex flex-wrap gap-1.5">
          {island.chips.map((c) => (
            <span key={c} className="rounded-full bg-white/7 px-2.5 py-1 text-xs font-medium text-muted">
              {c}
            </span>
          ))}
        </div>
      ) : null}

      <Rich text={island.disclosure} />

      <dl className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-bg/60">
        {island.rows.map((r) => (
          <div key={r.label} className="flex items-start justify-between gap-4 px-4 py-3 text-[14px]">
            <dt className="text-muted">{r.label}</dt>
            <dd className="text-right font-medium tabular-nums">
              {r.value === null ? <span className="text-muted">—</span> : r.estimate ? `≈ ${r.value}` : r.value}
              {r.estimate && r.value !== null ? <span className="ml-1.5 text-[11px] font-normal text-muted">est.</span> : null}
            </dd>
          </div>
        ))}
      </dl>

      {island.adjustments.length ? (
        <ul className="flex flex-col gap-1.5">
          {island.adjustments.map((a) => (
            <li key={a} className="flex gap-2 text-[13px] text-fg/80">
              <IconInfoCircle className="mt-0.5 size-4 shrink-0 text-accent" /> {a}
            </li>
          ))}
        </ul>
      ) : null}

      {island.risks.length ? (
        <ul className="flex flex-col gap-1.5 rounded-2xl border border-warn/25 bg-warn/8 p-3">
          {island.risks.map((r) => (
            <li key={r} className="flex gap-2 text-[13px] text-fg/85">
              <IconAlertTriangle className="mt-0.5 size-4 shrink-0 text-warn" /> {r}
            </li>
          ))}
        </ul>
      ) : null}

      {error ? <p className="text-sm text-danger">{error}</p> : null}

      <div className="mt-1 grid grid-cols-[1fr_1.6fr] gap-3">
        <div className="flex flex-col gap-1.5">
          <Button size="lg" variant="outline" disabled={busy !== null} onClick={() => act("cancel")}>
            Cancel
          </Button>
          <span className="text-center text-[11px] text-muted">{island.buttons.cancel}</span>
        </div>
        <div className="flex flex-col gap-1.5">
          <Button size="lg" variant="light" disabled={busy !== null || expired} onClick={() => act("confirm")}>
            Confirm
          </Button>
          <span className="text-center text-[11px] text-muted">{island.buttons.confirm}</span>
        </div>
      </div>
      <p className={cn("text-center text-xs", expired ? "text-danger" : "text-muted")}>
        {expired ? "This card expired. Ask again for a fresh one." : `Say “confirm”, or tap. Expires in ${label}.`}
      </p>
    </div>
  );
}

function ReceiptCard({ island, onDone, voice }: { island: ReceiptIsland; onDone: () => void; voice: VoiceBridge }) {
  const ok = island.status === "succeeded";
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col items-center gap-2 py-2 text-center">
        {ok ? <IconCircleCheckFilled className="size-14 text-success" /> : <IconCircleXFilled className="size-14 text-danger" />}
        <p className="text-xl font-semibold">{ok ? "Done" : "Didn't go through"}</p>
        {island.error ? <p className="text-sm text-muted">{island.error.message}</p> : null}
        <p className="text-xs text-muted">{(island.elapsedMs / 1000).toFixed(1)}s</p>
      </div>

      <div className="overflow-hidden rounded-2xl border border-line bg-bg/60 text-[14px]">
        <div className="grid grid-cols-[1fr_auto_auto] gap-x-4 border-b border-line px-4 py-2 text-[11px] uppercase tracking-wide text-muted">
          <span />
          <span className="text-right">Estimated</span>
          <span className="text-right">Actual</span>
        </div>
        {island.rows.map((r) => (
          <div key={r.label} className="grid grid-cols-[1fr_auto_auto] gap-x-4 px-4 py-2.5">
            <span className="text-muted">{r.label}</span>
            <span className="text-right tabular-nums text-muted">{r.estimated ?? "—"}</span>
            <span className="text-right font-medium tabular-nums">{r.actual ?? "—"}</span>
          </div>
        ))}
        {island.newBalance ? (
          <div className="flex justify-between border-t border-line px-4 py-2.5">
            <span className="text-muted">New balance</span>
            <span className="font-medium tabular-nums">{island.newBalance}</span>
          </div>
        ) : null}
      </div>

      {island.explorerUrl ? (
        <a
          href={island.explorerUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center justify-center gap-1.5 text-sm text-accent"
        >
          View on explorer <IconExternalLink className="size-4" />
        </a>
      ) : null}

      <div className={cn("grid gap-3", island.nextStep && voice.live ? "grid-cols-2" : "grid-cols-1")}>
        {island.nextStep && voice.live ? (
          <Button size="lg" variant="ghost" onClick={() => (voice.say(island.nextStep!.utterance), onDone())}>
            {island.nextStep.label}
          </Button>
        ) : null}
        <Button size="lg" variant="light" onClick={onDone}>
          Done
        </Button>
      </div>
    </div>
  );
}

function ChoiceCard({ island, onAnswered, voice }: { island: ChoiceIsland; onAnswered: () => void; voice: VoiceBridge }) {
  const [busy, setBusy] = React.useState<string | null>(null);
  async function pick(optionId: string, label: string) {
    setBusy(optionId);
    try {
      await api.post(`/choices/${island.choiceId}`, { optionId });
      voice.tell(`The user picked "${label}" on screen for: ${island.question}`);
      onAnswered();
    } finally {
      setBusy(null);
    }
  }
  return (
    <div className="flex flex-col gap-3">
      <p className="text-lg font-medium">{island.question}</p>
      {island.options.map((o) => (
        <button
          key={o.id}
          disabled={busy !== null}
          onClick={() => pick(o.id, o.label)}
          className="flex flex-col items-start rounded-2xl border border-line bg-bg/60 px-4 py-3 text-left active:bg-card-2 disabled:opacity-50"
        >
          <span className="font-medium">{o.label}</span>
          {o.detail ? <span className="text-sm text-muted">{o.detail}</span> : null}
        </button>
      ))}
    </div>
  );
}
