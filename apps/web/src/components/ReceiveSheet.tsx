import type { ReceiveIsland } from "@arcie/core";
import { IconCheck, IconCopy, IconShare } from "@tabler/icons-react";
import { QRCodeSVG } from "qrcode.react";
import * as React from "react";
import { Button } from "@/components/Button";
import { Drawer, DrawerContent } from "@/components/ui/drawer";
import { api } from "@/lib/api";
import { chainLabel } from "@/lib/format";
import { useIslands } from "@/lib/islands";
import { tokenLabel } from "@/lib/tokens";

/** Receive: the wallet address as a QR code, plus copy and share. */
export function ReceiveSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { receive: voiceReceive, clear } = useIslands();
  const [info, setInfo] = React.useState<ReceiveIsland | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [copied, setCopied] = React.useState(false);

  // The voice agent can also ask to show this sheet ("how do I get paid?").
  const shown = open || voiceReceive !== null;
  const data = info ?? voiceReceive;

  React.useEffect(() => {
    if (!open || info) return;
    api
      .post<{ island?: ReceiveIsland }>("/receive")
      .then((r) => (r.island ? setInfo(r.island) : setError("Couldn't load your address.")))
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Couldn't load your address."));
  }, [open, info]);

  function close(o: boolean) {
    if (o) return;
    onOpenChange(false);
    clear("receive");
    setCopied(false);
  }

  async function copy() {
    if (!data) return;
    await navigator.clipboard.writeText(data.address).catch(() => undefined);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  }

  async function share() {
    if (!data) return;
    if (navigator.share) await navigator.share({ title: "My Arcie address", text: data.address }).catch(() => undefined);
    else await copy();
  }

  return (
    <Drawer open={shown} onOpenChange={close}>
      <DrawerContent title="Receive" description={data ? `Only send ${data.tokens.map(tokenLabel).join(", ")} on ${chainLabel(data.chain)}.` : undefined}>
        <div className="flex flex-col items-center gap-5 pb-2">
          <div className="grid size-[248px] place-items-center rounded-3xl bg-white p-4">
            {data ? (
              <QRCodeSVG value={data.address} size={216} level="M" marginSize={0} />
            ) : (
              <div className="size-[216px] animate-pulse rounded-2xl bg-black/5" />
            )}
          </div>
          {error ? <p className="text-sm text-danger">{error}</p> : null}
          <p className="break-all px-2 text-center font-mono text-[13px] leading-relaxed text-muted">{data?.address ?? " "}</p>
          <div className="grid w-full grid-cols-2 gap-3">
            <Button size="lg" variant="ghost" onClick={copy} disabled={!data}>
              {copied ? <IconCheck className="size-5 text-success" /> : <IconCopy className="size-5" />}
              {copied ? "Copied" : "Copy"}
            </Button>
            <Button size="lg" variant="light" onClick={share} disabled={!data}>
              <IconShare className="size-5" /> Share
            </Button>
          </div>
        </div>
      </DrawerContent>
    </Drawer>
  );
}
