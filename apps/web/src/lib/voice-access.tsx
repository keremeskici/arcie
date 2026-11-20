import { IconMicrophone } from "@tabler/icons-react";
import * as React from "react";
import { cn } from "@/lib/cn";

export type VoiceHandoff = "receive" | "onramp" | "contacts" | "activity";

type VoiceAccess = {
  openVoice: (from?: HTMLElement) => void;
  visible: boolean;
  inBackground: boolean;
  activeSheet: VoiceHandoff | null;
  returnFocus: React.RefObject<HTMLElement | null>;
};

export const VoiceAccessContext = React.createContext<VoiceAccess | null>(null);
export const useVoiceAccess = () => React.useContext(VoiceAccessContext);

export function VoiceButton({ className }: { className?: string }) {
  const voice = useVoiceAccess();
  if (!voice) return null;
  return (
    <button
      type="button"
      aria-label={voice.inBackground ? "Return to voice" : "Talk to Arcie"}
      aria-haspopup="dialog"
      title={voice.inBackground ? "Return to voice conversation" : "Talk to Arcie"}
      onClick={(event) => voice.openVoice(event.currentTarget)}
      className={cn("grid size-11 shrink-0 place-items-center rounded-full text-muted hover:bg-card-2 focus-visible:outline-2 focus-visible:outline-accent", voice.inBackground && "bg-accent/15 text-accent", className)}
    >
      <IconMicrophone size={18} aria-hidden="true" />
    </button>
  );
}
