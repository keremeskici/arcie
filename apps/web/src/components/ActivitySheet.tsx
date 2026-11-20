import type { ActionKind, ConfirmIsland, ReceiptIsland } from "@arcie/core";
import { IconArrowLeft, IconChevronRight, IconRefresh } from "@tabler/icons-react";
import * as React from "react";
import { ReceiptCard } from "@/components/ActionSheet";
import { actionLabels, DetailRow, SheetFeedback, useSheetData, type SheetProps } from "./AccountSheetParts";
import { Button } from "./Button";
import { Drawer, DrawerContent } from "./ui/drawer";
import { useIslands } from "@/lib/islands";
import { useVoiceAccess } from "@/lib/voice-access";

type ActivityItem = { at: string; type: string; intentId: string | null; summary: string };
const eventLabels: Record<string, string> = {
  "intent.proposed": "Request created", "intent.requoted": "Quote updated", "intent.confirmed": "Confirmed",
  "intent.pending": "Processing", "intent.uncertain": "Checking submission", "intent.succeeded": "Completed",
  "intent.failed": "Failed", "intent.rejected": "Request declined", "intent.cancelled": "Cancelled",
  "onramp.submitted": "Payment submitted", "onramp.settled": "Payment update", "onramp.failed": "Payment failed",
};
const statusLabels = {
  awaiting_confirmation: "Awaiting confirmation", executing: "Processing", validating: "Checking request",
  succeeded: "Completed", failed: "Failed", expired: "Expired", cancelled: "Cancelled", rejected: "Declined",
};
type IntentDetail = {
  id: string; kind: ActionKind; status: keyof typeof statusLabels; statusReason: string | null;
  txHash: string | null; expiresAt: string | null; canReview: boolean;
  island: ConfirmIsland | ReceiptIsland | null; error: { code: string; message: string } | null;
};

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });
function Timestamp({ at }: { at: string }) {
  return <time dateTime={at}>{dateFormat.format(new Date(at))}</time>;
}

export function ActivitySheet({ onClose }: SheetProps) {
  const [id, setId] = React.useState<string | null>(null);
  return (
    <Drawer open onOpenChange={(open) => { if (!open) onClose(); }} voiceHandoff="activity">
      <DrawerContent title={id ? "Transaction details" : "Activity"}>
        {id ? (
          <div className="space-y-3">
            <Button variant="outline" onClick={() => setId(null)}><IconArrowLeft size={16} /> Activity</Button>
            <IntentDetails key={id} id={id} onClose={onClose} />
          </div>
        ) : <ActivityList onSelect={setId} />}
      </DrawerContent>
    </Drawer>
  );
}

function ActivityList({ onSelect }: { onSelect: (id: string) => void }) {
  const resource = useSheetData<{ items: ActivityItem[] }>("/activity");
  return <div className="space-y-4">
    <SheetFeedback resource={resource} label="activity" />
    {resource.data && <>
      {resource.data.items.length ? (
        <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-bg/60">
          {resource.data.items.map((item, index) => {
            const entry = <>
              <span className="flex items-baseline justify-between gap-2">
                <span className="font-medium">{eventLabels[item.type] ?? "Account update"}</span>
                <span className="text-right text-xs text-muted"><Timestamp at={item.at} /></span>
              </span>
              <span className="mt-1 flex items-center justify-between gap-3 text-sm text-muted">
                {item.summary}
                {item.intentId && <IconChevronRight size={16} className="shrink-0" aria-hidden="true" />}
              </span>
            </>;
            const id = item.intentId;
            return <li key={`${item.at}-${item.type}-${id}-${index}`}>
              {id ? <button className="block w-full p-3 text-left active:bg-card-2" onClick={() => onSelect(id)}>{entry}</button>
                : <div className="p-3">{entry}</div>}
            </li>;
          })}
        </ul>
      ) : <p className="py-2 text-sm text-muted">No activity yet.</p>}
      {!resource.error && <Button variant="ghost" className="w-full" onClick={resource.refresh} disabled={resource.loading}>
        <IconRefresh size={16} /> Refresh activity
      </Button>}
    </>}
  </div>;
}

function IntentDetails({ id, onClose }: { id: string } & SheetProps) {
  const { push } = useIslands();
  const fromVoice = useVoiceAccess()?.inBackground;
  const [showReceipt, setShowReceipt] = React.useState(false);
  const resource = useSheetData<IntentDetail>(`/intents/${encodeURIComponent(id)}`);
  const { data: intent, error, loading, refresh } = resource;

  React.useEffect(() => {
    if (!intent || error || loading) return;
    let delay: number;
    if (intent.status === "executing" || intent.status === "validating") delay = 4_000;
    else if (intent.status === "awaiting_confirmation" && intent.expiresAt && Date.parse(intent.expiresAt) > Date.now()) {
      delay = Date.parse(intent.expiresAt) - Date.now() + 1;
    } else return;
    const timer = window.setTimeout(refresh, delay);
    return () => window.clearTimeout(timer);
  }, [intent, error, loading, refresh]);

  const awaiting = intent?.status === "awaiting_confirmation";
  const expired = intent?.status === "expired" || (awaiting && intent.expiresAt !== null && Date.parse(intent.expiresAt) <= Date.now());
  const card = intent?.island;
  const review = card?.kind === "confirm" && awaiting && !expired && intent.canReview;
  const receipt = card?.kind === "receipt" && (intent?.status === "succeeded" || intent?.status === "failed");
  const reason = intent?.statusReason === "superseded" ? "Replaced by a newer request."
    : intent?.statusReason === "user" ? "Cancelled by you."
    : intent?.statusReason === "price_changed" ? "The price moved below your minimum before the swap could start."
    : intent?.statusReason === "submission_unknown" ? null : intent?.statusReason;

  if (receipt && showReceipt) return <ReceiptCard island={card} onDone={() => setShowReceipt(false)} />;

  function openCard() {
    if (!card) return;
    if (card.kind === "receipt" && fromVoice) {
      setShowReceipt(true);
      return;
    }
    push(card);
    onClose();
  }

  return <div className="space-y-3">
    <SheetFeedback resource={resource} label="transaction details" />
    {intent && <>
      <dl className="divide-y divide-line rounded-2xl border border-line bg-bg/60 px-3">
        <DetailRow label="Action">{actionLabels[intent.kind]}</DetailRow>
        <DetailRow label="Current status">{expired ? "Expired" : statusLabels[intent.status]}</DetailRow>
        {awaiting && intent.expiresAt && <DetailRow label="Review deadline"><Timestamp at={intent.expiresAt} /></DetailRow>}
        {intent.txHash && <DetailRow label="Transaction hash"><span className="select-all font-mono text-xs">{intent.txHash}</span></DetailRow>}
      </dl>
      {reason && <p className="text-sm text-muted">{reason}</p>}
      {intent.error && intent.error.message !== reason && <p className="text-sm text-muted">{intent.error.message}</p>}
      {awaiting && !expired && !intent.canReview && <p className="text-sm text-muted">This request was created in another session. Start a new request here to review it.</p>}
      {expired && <p className="text-sm text-muted">Start a new request for a fresh review.</p>}
      {(review || receipt) && <Button variant="light" className="w-full" disabled={loading || !!error} onClick={openCard}>
        {review ? "Open review" : "View receipt"}
      </Button>}
      {!error && <Button variant="ghost" className="w-full" onClick={refresh} disabled={loading}>
        <IconRefresh size={16} /> Refresh status
      </Button>}
    </>}
  </div>;
}
