import { SiriOrb } from "@/components/ui/siri-orb";

export function Splash({ message, onRetry }: { message?: string; onRetry?: () => void }) {
  return (
    <div className="phone items-center justify-center gap-6">
      <SiriOrb size="72px" animationDuration={8} colors={{ bg: "#0a0a0f" }} />
      {message ? <p className="px-8 text-center text-sm text-muted">{message}</p> : null}
      {onRetry && <button onClick={onRetry} className="rounded-xl bg-card px-4 py-2 text-sm">Try again</button>}
    </div>
  );
}
