import { useConversation } from "@elevenlabs/react";
import { Dialog } from "@base-ui/react/dialog";
import type { ReceiptIsland } from "@arcie/core";
import { IconMicrophone, IconMicrophoneOff, IconX } from "@tabler/icons-react";
import * as React from "react";
import { VoiceActionReview } from "@/components/ActionSheet";
import { SiriOrb } from "@/components/ui/siri-orb";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { confirmKey, useIslands } from "@/lib/islands";

type Line = { role: "user" | "agent"; text: string };
const REVIEW_TRANSITION_MS = 300;

/**
 * Transaction reviews share the active conversation. Closing voice releases the connection.
 */
export function VoiceScreen({ agentId, sessionId, sessionError, visible = true, onClose }: {
  agentId: string | null;
  sessionId: string | null;
  sessionError?: string | null;
  visible?: boolean;
  onClose: () => void;
}) {
  const [last, setLast] = React.useState<Line>();
  const [lastUser, setLastUser] = React.useState<string>();
  const [connectionError, setError] = React.useState<string | null>(null);
  const error = sessionError ?? connectionError;
  const [ended, setEnded] = React.useState(false);
  const { confirm, choice, processing: transactionProgress, receipt, steps: latestSteps } = useIslands();
  // Only show the trace for runs that started after this screen opened.
  const [staleRunId] = React.useState(() => latestSteps?.runId ?? null);
  const steps = latestSteps && latestSteps.runId !== staleRunId ? latestSteps : null;
  const working = steps?.steps.findLast(step => step.status === "running");
  const review = choice ?? confirm;
  const reviewKey = review?.kind === "confirm" ? confirmKey(review) : review?.choiceId;
  const processing = review?.kind === "confirm" ? transactionProgress : null;
  const reviewOpen = review !== null;
  const [shownReview, setShownReview] = React.useState({ review, processing });
  // Keep the outgoing contents in place for the collapse, with their controls immediately disabled.
  if (review && (shownReview.review !== review || shownReview.processing !== processing)) setShownReview({ review, processing });
  React.useEffect(() => {
    if (reviewOpen || !shownReview.review) return;
    const delay = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? 0 : REVIEW_TRANSITION_MS;
    const timeout = setTimeout(() => setShownReview({ review: null, processing: null }), delay);
    return () => clearTimeout(timeout);
  }, [reviewOpen, shownReview.review]);

  const [currentReceipt, setCurrentReceipt] = React.useState<ReceiptIsland | null>(null);
  if (reviewOpen && currentReceipt) setCurrentReceipt(null);
  if (!reviewOpen && receipt && receipt !== currentReceipt && shownReview.review?.kind === "confirm" && shownReview.review.intentId === receipt.intentId) {
    setCurrentReceipt(receipt);
  }
  const receiptId = currentReceipt?.intentId;
  const processingId = processing?.intentId;
  const [transcript, setTranscript] = React.useState({ reviewKey, receiptId, processingId, previousLine: undefined as Line | undefined });
  if (transcript.reviewKey !== reviewKey || transcript.receiptId !== receiptId || transcript.processingId !== processingId) {
    const previousLine = !reviewOpen || processingId || last?.role === "agent" ? last : transcript.previousLine;
    setTranscript({ reviewKey, receiptId, processingId, previousLine });
  }
  const currentLine = last !== transcript.previousLine ? last : undefined;
  const result = !reviewOpen && !currentLine && currentReceipt
    ? currentReceipt.status === "succeeded" ? "Transaction complete." : currentReceipt.error?.message ?? "The transaction didn't go through."
    : null;
  const conv = useConversation({
    onMessage: (m) => {
      const role = m.source === "user" ? "user" : "agent";
      if (role === "user") setLastUser(m.message);
      setLast({ role, text: m.message });
    },
    onError: (message) => setError(typeof message === "string" ? message : "Voice connection error."),
    onDisconnect: (details) => {
      if (details.reason === "error") setError(details.message);
      else setEnded(true);
    },
  });
  const { status, isSpeaking, isMuted, setMuted, startSession, endSession, getInputVolume, getOutputVolume } = conv;
  const orbRef = React.useRef<HTMLDivElement>(null);
  const reviewRef = React.useRef<HTMLDivElement>(null);
  const closeButton = React.useRef<HTMLButtonElement>(null);
  React.useLayoutEffect(() => {
    if (!reviewOpen && reviewRef.current?.contains(document.activeElement)) closeButton.current?.focus();
  }, [reviewOpen]);

  // Start once on open; end when the screen closes.
  React.useEffect(() => {
    if (!agentId) {
      setError("Voice isn't set up for this wallet.");
      return;
    }
    if (!sessionId) return;
    if (!navigator.mediaDevices?.getUserMedia) {
      setError("This browser cannot access a microphone. Open Arcie in a browser with microphone support.");
      return;
    }
    setError(null);
    setEnded(false);
    const startup = new AbortController();
    let started = false;
    // Let an immediately unmounted screen cancel before requesting permission.
    void Promise.resolve().then(async () => {
      if (startup.signal.aborted) return;
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        stream.getTracks().forEach((track) => track.stop()); // The SDK opens its own stream.
      } catch {
        if (!startup.signal.aborted) setError("Arcie needs microphone access to listen.");
        return;
      }
      if (startup.signal.aborted) return;
      try {
        const { conversationId } = await api.post<{ conversationId: string }>("/voice/conversation", {}, sessionId, startup.signal);
        if (startup.signal.aborted) return;
        if (!conversationId) throw new Error("Couldn’t start the voice conversation.");
        started = true;
        startSession({ agentId, connectionType: "webrtc", customLlmExtraBody: { session_id: sessionId, arcie_conversation_id: conversationId } });
      } catch (e) {
        if (!startup.signal.aborted) setError(e instanceof Error ? e.message : "Couldn’t start the voice conversation.");
      }
    });
    return () => {
      startup.abort();
      if (started) endSession();
    };
  }, [agentId, sessionId, startSession, endSession]);

  // Orb breathes with whoever is talking.
  React.useEffect(() => {
    if (!visible) return;
    const motion = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    let raf = 0;
    const tick = () => {
      const level = status === "connected" && !motion?.matches ? Math.max(getInputVolume(), getOutputVolume()) : 0;
      if (orbRef.current) orbRef.current.style.transform = `scale(${1 + Math.min(level, 1) * 0.35})`;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [visible, status, getInputVolume, getOutputVolume]);

  const label =
    error ? "Voice unavailable"
    : ended ? "Conversation ended"
    : !sessionId ? "Starting…"
    : status === "connecting" ? "Connecting…"
    : status !== "connected" ? "Starting…"
    : isSpeaking ? "Arcie is speaking"
    : !reviewOpen && !result && working ? working.label
    : isMuted ? "Muted"
    : "Listening…";

  return (
    <Dialog.Root open={visible} onOpenChange={(open) => { if (!open) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Popup initialFocus={closeButton} finalFocus={false}
          className="fixed inset-0 z-[120] flex justify-center bg-bg outline-none">
          <Dialog.Title className="sr-only">Voice conversation</Dialog.Title>
          <div className="phone voice-panel px-5">
            <header className="flex shrink-0 items-center justify-between pt-3">
              <span className="rounded-full bg-white/5 px-3 py-1 text-xs text-muted">Arcie · voice</span>
              <Dialog.Close ref={closeButton} className="grid size-10 place-items-center rounded-full bg-card text-muted" aria-label="Close voice">
                <IconX className="size-5" />
              </Dialog.Close>
            </header>

            <div className="voice-stage" data-review={reviewOpen} style={{ "--voice-review-duration": `${REVIEW_TRANSITION_MS}ms` } as React.CSSProperties}>
              <div className="voice-presence">
                <div className="voice-orb-frame" aria-hidden="true">
                  <div ref={orbRef} className="size-full transition-transform duration-75 will-change-transform motion-reduce:transition-none">
                    <SiriOrb
                      size="232px"
                      style={{ width: "100%", height: "100%" }}
                      animationDuration={isSpeaking ? 5 : 12}
                      colors={{ bg: "#0a0a0f", ...(isSpeaking ? { c1: "oklch(78% 0.17 300)", c2: "oklch(82% 0.13 210)" } : {}) }}
                      className={cn(status !== "connected" && "opacity-60")}
                    />
                  </div>
                </div>
                <div className="voice-caption w-full text-center">
                  <p className={cn("font-medium", error && "text-danger")}>{label}</p>
                  {error ? <p role="alert" className="mt-1 text-sm text-muted">{error}</p> : null}
                  {!reviewOpen && currentLine?.role === "agent" && lastUser && (
                    <p className="voice-utterance text-sm text-muted">“{lastUser}”</p>
                  )}
                  {result ? (
                    <p role="status" className={cn("voice-utterance", currentReceipt?.status === "failed" && "text-danger")}>{result}</p>
                  ) : currentLine ? (
                    <p className={cn("voice-utterance", currentLine.role === "user" && "text-muted")}>
                      {currentLine.role === "user" ? `“${currentLine.text}”` : currentLine.text}
                    </p>
                  ) : !reviewOpen && !error && !ended && !last ? (
                    <p className="voice-utterance text-sm text-muted">Try “What's my balance?” or “Put one dollar in savings”.</p>
                  ) : null}
                </div>
              </div>
              <div ref={reviewRef} className="voice-review-slot" aria-hidden={!reviewOpen} inert={!reviewOpen}>
                {shownReview.review && (
                  <section aria-label={shownReview.review.kind === "confirm" ? "Transaction review" : "Choose an option"} className="voice-review-card">
                    <VoiceActionReview island={shownReview.review} processing={shownReview.processing} />
                  </section>
                )}
              </div>
            </div>

            <div className="voice-controls flex shrink-0 items-center justify-center gap-5">
              <button
                className={cn("grid size-14 place-items-center rounded-full border border-line", isMuted ? "bg-white text-black" : "bg-card")}
                onClick={() => setMuted(!isMuted)}
                disabled={!!error || ended || status !== "connected"}
                aria-label={isMuted ? "Unmute" : "Mute"}
              >
                {isMuted ? <IconMicrophoneOff className="size-6" /> : <IconMicrophone className="size-6" />}
              </button>
              <button className="grid size-14 place-items-center rounded-full bg-danger text-bg" onClick={onClose} aria-label="End conversation">
                <IconX className="size-7" />
              </button>
            </div>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
