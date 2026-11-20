import type { ChoiceIsland, ConfirmIsland, IslandPayload, ProcessingIsland, ReceiptIsland, RichText } from "@arcie/core";
import { useConversationControls, useConversationStatus } from "@elevenlabs/react";
import { IconAlertTriangle, IconCircleXFilled, IconExternalLink, IconInfoCircle, IconLoader2 } from "@tabler/icons-react";
import * as React from "react";
import { Button } from "@/components/Button";
import { TransactionProgress, TransactionSuccess } from "@/components/TransactionProgress";
import { Drawer, DrawerContent } from "@/components/ui/drawer";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { useIslands } from "@/lib/islands";
import { useVoiceAccess } from "@/lib/voice-access";

/**
 * Wallet review drawer. During voice, the same approval controls are shown inside the conversation.
 */
export function ActionSheet({ onFollowUp }: { onFollowUp?: (message: string) => void } = {}) {
  const { confirm, receipt, choice, processing, push, clear } = useIslands();
  const voiceAccess = useVoiceAccess();
  const inVoice = voiceAccess?.visible || voiceAccess?.inBackground;
  const voice = useVoiceBridge();
  const [hiddenIntent, setHiddenIntent] = React.useState<string | null>(null);
  const [receiptPresentation, setReceiptPresentation] = React.useState({ receipt, inline: false });
  if (receipt !== receiptPresentation.receipt) setReceiptPresentation({ receipt, inline: !!inVoice });
  const voiceReceiptId = receiptPresentation.inline ? receiptPresentation.receipt?.intentId : undefined;
  React.useEffect(() => {
    if (!inVoice && voiceReceiptId) clear("receipt", voiceReceiptId);
  }, [inVoice, voiceReceiptId, clear]);

  const card = inVoice ? null : choice ? "choice" : confirm ? "confirm" : receipt && receipt.intentId !== voiceReceiptId ? "receipt" : null;
  const hidden = card === "confirm" && hiddenIntent === confirm?.intentId;
  const open = card !== null && !hidden;

  function onOpenChange(o: boolean) {
    if (o) return;
    if (card === "confirm" && confirm) setHiddenIntent(confirm.intentId); // hiding isn't cancelling
    if (card === "receipt") clear("receipt");
  }

  if (card === "choice" && choice) return <ChoiceCard key={choice.choiceId} island={choice} voice={voice} />;

  return (
    <>
      {hidden ? (
        <button
          onClick={() => setHiddenIntent(null)}
          className="fixed left-1/2 top-[calc(env(safe-area-inset-top)+12px)] z-[60] flex -translate-x-1/2 items-center gap-2 rounded-full border border-accent/40 bg-card-2 px-4 py-2 text-sm shadow-xl"
        >
          <span className="size-2 animate-pulse rounded-full bg-accent" /> Waiting for your OK · Review
        </button>
      ) : null}
      <Drawer open={open} onOpenChange={onOpenChange}>
        <DrawerContent showClose={card !== "confirm"} title={sheetTitle(card)}
          showHeading={!(card === "confirm" && confirm && (isSendReview(confirm) || isSavingsDeposit(confirm)))}>
          {card === "confirm" && confirm ? (
            <ConfirmCard key={confirm.intentId + confirm.expiresAt} island={confirm} onResult={push} voice={voice} processing={processing} />
          ) : card === "receipt" && receipt ? (
            <ReceiptCard island={receipt} onDone={() => clear("receipt")} followUp={voice.live ? voice.say : onFollowUp} />
          ) : null}
        </DrawerContent>
      </Drawer>
    </>
  );
}

export function VoiceActionReview({ island, processing }: { island: ConfirmIsland | ChoiceIsland; processing: ProcessingIsland | null }) {
  const { push } = useIslands();
  const voice = useVoiceBridge();
  return island.kind === "confirm" ? (
    <ConfirmCard key={island.intentId + island.expiresAt} island={island} onResult={push} voice={voice} processing={processing} inline />
  ) : (
    <div className="min-h-0 overflow-y-auto overscroll-contain">
      <ChoiceCard key={island.choiceId} island={island} voice={voice} inline />
    </div>
  );
}

const sheetTitle = (c: string | null) => (c === "receipt" ? "Receipt" : "Please confirm");
const voiceProgressLabel = { send: "Sending…", swap: "Swapping…", earn_deposit: "Adding to savings…", earn_withdraw: "Withdrawing from savings…" };

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

function isSendReview(island: ConfirmIsland) {
  return island.action ? island.action === "send" : island.chips[0] === "Send";
}

function isSavingsDeposit(island: ConfirmIsland) {
  return island.action === "earn_deposit" && island.rows.some(row => row.label === "To" && row.value === "Savings");
}

function ConfirmCard({ island, onResult, voice, processing, inline = false }: {
  island: ConfirmIsland; onResult: (i: IslandPayload) => void; voice: VoiceBridge; processing: ProcessingIsland | null; inline?: boolean;
}) {
  const [busy, setBusy] = React.useState<"confirm" | "cancel" | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState<string | null>(null);
  const { clear } = useIslands();
  const watching = !!processing || !!pending;
  const progressNote = error ?? processing?.summary ?? pending;
  const unverified = processing?.unverified === true;
  React.useEffect(() => {
    if (!watching) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    async function refresh() {
      try {
        const detail = await api.get<{ island?: IslandPayload; statusReason?: string; error?: { message: string } }>(`/intents/${island.intentId}`);
        if (active && detail.island) { onResult(detail.island); return; }
        if (active && detail.statusReason === "submission_unknown" && detail.error) {
          onResult({ kind: "processing", intentId: island.intentId, unverified: true, summary: detail.error.message });
        }
      } catch {
        if (active) setError("Couldn't refresh this transaction. You can check it in Activity.");
      }
      if (active) timer = setTimeout(refresh, 4000);
    }
    timer = setTimeout(refresh, 4000);
    return () => { active = false; clearTimeout(timer); };
  }, [watching, island.intentId, onResult]);
  const { left, label } = useCountdown(island.expiresAt);
  const expired = left === 0;

  async function act(kind: "confirm" | "cancel") {
    setBusy(kind);
    setError(null);
    try {
      const path = `/intents/${island.intentId}`;
      if (kind === "cancel") {
        const result = await api.post<{ cancelled: boolean; summary: string }>(`${path}/cancel`);
        if (result.cancelled) {
          onResult({ kind: "dismiss", intentId: island.intentId, reason: "cancelled" });
          voice.tell(`The user cancelled intent ${island.intentId} on screen.`);
          return;
        }
        const detail = await api.get<{ status: string; island?: IslandPayload }>(path);
        if (detail.island) onResult(detail.island);
        else if (detail.status === "executing") {
          setBusy("confirm");
          setPending("This transaction is already processing.");
          return;
        } else {
          clear("confirm", island.intentId);
        }
        setBusy(null);
        return;
      }

      const result = await api.post<{ island?: IslandPayload; summary?: string; status: string }>(`${path}/confirm`, { channel: "screen" });
      voice.tell(result.summary ?? "The user tapped confirm.");
      if (result.island) {
        setBusy(null);
        onResult(result.island);
      } else if (result.status === "executing") {
        setPending(result.summary ?? "This request is still processing.");
      } else {
        setBusy(null);
        setError(result.summary ?? "Check the request before confirming again.");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "That didn't go through.");
      setBusy(null);
    }
  }

  if (busy === "confirm" || watching) {
    if (inline) {
      return (
        <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center">
          <div role="status" className="flex items-center gap-2 text-[17px] font-medium">
            {unverified ? <IconInfoCircle aria-hidden="true" className="size-5 text-warn" />
              : <IconLoader2 aria-hidden="true" className="size-5 animate-spin text-accent motion-reduce:animate-none" />}
            {unverified ? "Status unverified" : island.action ? voiceProgressLabel[island.action] : "Processing your transaction…"}
          </div>
          {progressNote && <p className="text-sm text-muted">{progressNote}</p>}
          {watching && <Button variant="outline" onClick={() => clear("confirm", island.intentId)}>View later in Activity</Button>}
        </div>
      );
    }
    return <>
      <TransactionProgress island={island} />
      {watching && <div className="mt-3 space-y-3 text-center">
        {progressNote && <p className="text-sm text-muted">{progressNote}</p>}
        <Button variant="outline" onClick={() => clear("confirm", island.intentId)}>View later in Activity</Button>
      </div>}
    </>;
  }

  const send = isSendReview(island);
  const savingsDeposit = isSavingsDeposit(island);
  const compact = send || savingsDeposit;
  const details = island.send;
  const title = send && details ? `Send ${details.amount} ${details.token} to ${details.recipient}` : island.title;
  const rows = send && details ? island.rows.map(row => row.label === "Amount"
    ? { ...row, value: `${details.amount} ${details.token}` }
    : row) : savingsDeposit ? island.rows.filter(row => row.label !== "Amount" && row.label !== "To") : island.rows;
  const risks = send ? island.risks.filter(r => r !== "Onchain transfers can't be reversed.") : island.risks;

  return (
    <div className={cn("flex flex-col gap-4", inline && "min-h-0 flex-1 gap-3")}>
      <div tabIndex={inline ? 0 : undefined} role={inline ? "group" : undefined} aria-label={inline ? "Transaction details" : undefined}
        className={cn("flex flex-col gap-4", inline && "min-h-0 gap-3 overflow-y-auto overscroll-contain rounded-lg focus-visible:outline-1 focus-visible:-outline-offset-1 focus-visible:outline-accent")}>
        <h2 className={cn("text-[22px] font-semibold leading-snug tracking-tight [overflow-wrap:anywhere]", compact && !inline && "pr-10", inline && "text-[20px]")}>{title}</h2>

        {!inline && !compact && island.chips.length ? (
          <div className="flex flex-wrap gap-1.5">
            {island.chips.map((c) => (
              <span key={c} className="rounded-full bg-white/7 px-2.5 py-1 text-xs font-medium text-muted">
                {c}
              </span>
            ))}
          </div>
        ) : null}

        {!compact && <Rich text={island.disclosure} />}

        <dl className="shrink-0 divide-y divide-line overflow-hidden rounded-2xl border border-line bg-bg/60">
          {rows.map((r) => (
            <div key={r.label} className={cn("flex items-start justify-between gap-4 px-4 py-3 text-[14px]", inline && "px-3 py-2")}>
              <dt className="text-muted">{r.label}</dt>
              <dd className={cn("text-right font-medium tabular-nums", send && "min-w-0 [overflow-wrap:anywhere]")}>
                {r.value === null ? <span className="text-muted">—</span> : r.estimate ? `≈ ${r.value}` : r.value}
                {r.estimate && r.value !== null ? <span className="ml-1.5 text-[11px] font-normal text-muted">est.</span> : null}
              </dd>
            </div>
          ))}
          {send && details?.address && (
            <div className="flex items-start justify-between gap-4 px-4 py-3 text-[14px]">
              <dt className="text-muted">Address</dt>
              <dd className="min-w-0 select-all break-all text-right font-mono text-xs">{details.address}</dd>
            </div>
          )}
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

        {risks.length ? (
          <ul className="flex flex-col gap-1.5 rounded-2xl border border-warn/25 bg-warn/8 p-3">
            {risks.map((r) => (
              <li key={r} className="flex gap-2 text-[13px] text-fg/85">
                <IconAlertTriangle className="mt-0.5 size-4 shrink-0 text-warn" /> {r}
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      {error ? <p role="alert" className="text-sm text-danger">{error}</p> : null}

      <div className="mt-1 grid shrink-0 grid-cols-[1fr_1.6fr] gap-3">
        <div className="flex flex-col gap-1.5">
          <Button size="lg" variant="outline" disabled={busy !== null} onClick={() => act("cancel")}>
            Cancel
          </Button>
          {!compact && !inline && <span className="text-center text-[11px] text-muted">{island.buttons.cancel}</span>}
        </div>
        <div className="flex flex-col gap-1.5">
          <Button size="lg" variant="light" disabled={busy !== null || expired} onClick={() => act("confirm")}>
            Confirm
          </Button>
          {!compact && !inline && <span className="text-center text-[11px] text-muted">{island.buttons.confirm}</span>}
        </div>
      </div>
      {(!send || expired) && <p className={cn("text-center text-xs", expired ? "text-danger" : "text-muted")}>
        {expired ? "This card expired. Ask again for a fresh one."
          : savingsDeposit || inline ? `Expires in ${label}` : `Say “confirm”, or tap. Expires in ${label}.`}
      </p>}
    </div>
  );
}

export function ReceiptCard({ island, onDone, followUp }: { island: ReceiptIsland; onDone: () => void; followUp?: (message: string) => void }) {
  const ok = island.status === "succeeded";
  return (
    <div className="flex flex-col gap-4">
      <div role="status" className="flex flex-col items-center gap-2 py-2 text-center">
        {ok ? <TransactionSuccess /> : <IconCircleXFilled className="size-14 text-danger" />}
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

      <div className={cn("grid gap-3", island.nextStep && followUp ? "grid-cols-2" : "grid-cols-1")}>
        {island.nextStep && followUp ? (
          <Button size="lg" variant="ghost" onClick={() => { followUp(island.nextStep!.utterance); onDone(); }}>
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

function ChoiceCard({ island, voice, inline = false }: { island: ChoiceIsland; voice: VoiceBridge; inline?: boolean }) {
  const [busy, setBusy] = React.useState(false);
  const { push } = useIslands();
  const [error, setError] = React.useState<string | null>(null);
  const path = `/choices/${encodeURIComponent(island.choiceId)}`;

  async function pick(optionId: string, label: string) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await api.post<{ island?: IslandPayload; summary?: string }>(path, { optionId, prepare: true });
      if (island.send && result.island?.kind !== "confirm") throw new Error(result.summary ?? "Couldn't prepare your review.");
      if (result.island) push(result.island);
      push({ kind: "dismiss_choice", choiceId: island.choiceId });
      voice.tell(`The user picked "${label}" on screen.${result.summary ? ` ${result.summary}` : ""}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn’t select that contact.");
    } finally {
      setBusy(false);
    }
  }

  async function dismiss() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await api.delete(path);
      push({ kind: "dismiss_choice", choiceId: island.choiceId });
      voice.tell("The user dismissed the contact choices on screen.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn’t dismiss the contact choices.");
    } finally {
      setBusy(false);
    }
  }

  const contents = (
    <div className="flex flex-col gap-3">
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      <p className="text-lg font-medium">{island.question}</p>
      {island.options.map((o) => (
        <button
          key={o.id}
          disabled={busy}
          onClick={() => pick(o.id, o.label)}
          className="flex flex-col items-start rounded-2xl border border-line bg-bg/60 px-4 py-3 text-left active:bg-card-2 disabled:opacity-50"
        >
          <span className="font-medium">{o.label}</span>
          {o.detail ? <span className="text-sm text-muted">{o.detail}</span> : null}
        </button>
      ))}
      <Button variant="outline" onClick={dismiss} disabled={busy}>Cancel</Button>
    </div>
  );
  return inline ? contents : (
    <Drawer open onOpenChange={open => { if (!open) void dismiss(); }}>
      <DrawerContent title="Quick question">{contents}</DrawerContent>
    </Drawer>
  );
}
