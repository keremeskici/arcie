import { useConversation } from "@elevenlabs/react";
import { IconCheck, IconLoader2, IconMicrophone, IconMicrophoneOff, IconX } from "@tabler/icons-react";
import * as React from "react";
import { SiriOrb } from "@/components/ui/siri-orb";
import { cn } from "@/lib/cn";
import { useIslands } from "@/lib/islands";

type Line = { role: "user" | "agent"; text: string };

/**
 * Full-screen voice portal. ElevenLabs does speech; our server is its custom LLM and only ever proposes.
 * Confirm cards from the agent appear in the ActionSheet on top of this screen.
 */
export function VoiceScreen({ agentId, sessionId, sessionError, onClose }: { agentId: string | null; sessionId: string | null; sessionError?: string; onClose: () => void }) {
  const [lines, setLines] = React.useState<Line[]>([]);
  const [connectionError, setError] = React.useState<string | null>(agentId ? null : "Voice isn't set up on the server (ELEVENLABS_AGENT_ID).");
  const error = sessionError ?? connectionError;
  const { steps: latestSteps } = useIslands();
  // Only show the trace for runs that started after this screen opened.
  const [staleRunId] = React.useState(() => latestSteps?.runId ?? null);
  const steps = latestSteps && latestSteps.runId !== staleRunId ? latestSteps : null;
  const conv = useConversation({
    onMessage: (m) => setLines((l) => [...l.slice(-5), { role: m.source === "user" ? "user" : "agent", text: m.message }]),
    onError: (message) => setError(typeof message === "string" ? message : "Voice connection error."),
  });
  const { status, isSpeaking, isMuted, setMuted, startSession, endSession, getInputVolume, getOutputVolume } = conv;
  const orbRef = React.useRef<HTMLDivElement>(null);

  // Start once on open; end when the screen closes.
  React.useEffect(() => {
    if (!agentId || !sessionId) return;
    let cancelled = false;
    let started = false;
    navigator.mediaDevices
      .getUserMedia({ audio: true })
      .then(async (stream) => {
        stream.getTracks().forEach((t) => t.stop()); // the SDK opens its own stream
        if (cancelled) return;
        started = true;
        await startSession({ agentId, connectionType: "webrtc", customLlmExtraBody: { session_id: sessionId } });
        if (cancelled) endSession();
      })
      .catch(() => { if (!cancelled) setError(started ? "Couldn’t connect to voice." : "Arcie needs microphone access to listen."); });
    return () => {
      cancelled = true;
      if (started) endSession();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentId, sessionId]);

  // Orb breathes with whoever is talking.
  React.useEffect(() => {
    let raf = 0;
    const tick = () => {
      const level = status === "connected" ? Math.max(getInputVolume(), getOutputVolume()) : 0;
      if (orbRef.current) orbRef.current.style.transform = `scale(${1 + Math.min(level, 1) * 0.35})`;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [status, getInputVolume, getOutputVolume]);

  const label =
    error ? "Voice unavailable"
    : status === "connecting" ? "Connecting…"
    : status !== "connected" ? "Starting…"
    : isSpeaking ? "Arcie is speaking"
    : isMuted ? "Muted"
    : "Listening…";

  const last = lines.at(-1);
  const prevUser = [...lines].reverse().find((l) => l.role === "user");

  return (
    <div className="fixed inset-0 z-50 flex justify-center bg-bg/95 backdrop-blur-xl">
      <div className="phone px-6">
        <header className="flex items-center justify-between pt-5">
          <span className="rounded-full bg-white/5 px-3 py-1 text-xs text-muted">Arcie · voice</span>
          <button className="grid size-10 place-items-center rounded-full bg-card text-muted" onClick={onClose} aria-label="Close voice">
            <IconX className="size-5" />
          </button>
        </header>

        <div className="flex flex-1 flex-col items-center justify-center gap-10">
          <div ref={orbRef} className="transition-transform duration-75 will-change-transform">
            <SiriOrb
              size="232px"
              animationDuration={isSpeaking ? 5 : 12}
              colors={{ bg: "#0a0a0f", ...(isSpeaking ? { c1: "oklch(78% 0.17 300)", c2: "oklch(82% 0.13 210)" } : {}) }}
              className={cn(status !== "connected" && "opacity-60")}
            />
          </div>
          <div className="min-h-[120px] w-full text-center">
            <p className={cn("text-lg font-medium", error && "text-danger")}>{label}</p>
            {error ? <p className="mt-2 text-sm text-muted">{error}</p> : null}
            {prevUser && last?.role === "agent" ? <p className="mt-4 text-sm text-muted">“{prevUser.text}”</p> : null}
            {last ? (
              <p className={cn("mx-auto mt-2 max-w-[32ch] text-[17px] leading-snug", last.role === "user" ? "text-muted" : "text-fg")}>
                {last.role === "user" ? `“${last.text}”` : last.text}
              </p>
            ) : !error ? (
              <p className="mt-3 text-sm text-muted">Try “What's my balance?” or “Send 1 dollar to Savings”.</p>
            ) : null}
          </div>
        </div>

        {steps && steps.steps.length ? (
          <ol className="mb-5 flex flex-col gap-1.5 rounded-2xl border border-line bg-card/80 p-3 text-[13px]">
            {steps.steps.slice(-3).map((s) => (
              <li key={s.id} className="flex items-center gap-2">
                {s.status === "running" ? (
                  <IconLoader2 className="size-4 animate-spin text-accent" />
                ) : s.status === "done" ? (
                  <IconCheck className="size-4 text-success" />
                ) : (
                  <IconX className="size-4 text-danger" />
                )}
                <span className={cn(s.status === "failed" && "text-danger")}>{s.error ?? s.label}</span>
              </li>
            ))}
          </ol>
        ) : null}

        <div className="flex items-center justify-center gap-6 pb-10">
          <button
            className={cn("grid size-16 place-items-center rounded-full border border-line", isMuted ? "bg-white text-black" : "bg-card")}
            onClick={() => setMuted(!isMuted)}
            disabled={status !== "connected"}
            aria-label={isMuted ? "Unmute" : "Mute"}
          >
            {isMuted ? <IconMicrophoneOff className="size-6" /> : <IconMicrophone className="size-6" />}
          </button>
          <button className="grid size-16 place-items-center rounded-full bg-danger text-white" onClick={onClose} aria-label="End conversation">
            <IconX className="size-7" />
          </button>
        </div>
      </div>
    </div>
  );
}
