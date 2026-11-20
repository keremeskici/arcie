import { SiriOrb } from "@/components/ui/siri-orb";

export function Splash({ message }: { message?: string }) {
  return (
    <div className="phone items-center justify-center gap-6">
      <SiriOrb size="72px" animationDuration={8} colors={{ bg: "#0a0a0f" }} />
      {message ? <p className="px-8 text-center text-sm text-muted">{message}</p> : null}
    </div>
  );
}
