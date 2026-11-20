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

  const [loadError, setLoadError] = React.useState("");
  const [attempt, setAttempt] = React.useState(0);

  // The voice agent can also ask to show this sheet ("how do I get paid?").
  const shown = open || voiceReceive !== null;
  const data = voiceReceive ?? info;

  React.useEffect(() => {
    if (!open || data) return;
    let active = true;
    setLoadError("");
    api.post<{ island?: ReceiveIsland }>("/receive?delivery=response").then(({ island }) => {
      if (!active) return;
      if (island?.kind === "receive") setInfo(island);
      else setLoadError("Couldn't load your address.");
    }).catch((e: unknown) => {
      if (active) setLoadError(e instanceof Error ? e.message : "Couldn't load your address.");
    });
    return () => { active = false; };
  }, [open, data, attempt]);

  function close(o: boolean) {
    if (o) return;
    onOpenChange(false);
    clear("receive");
    setInfo(null);
    setLoadError("");
  }

  return (
    <Drawer open={shown} onOpenChange={close} voiceHandoff="receive">
      <DrawerContent title="Receive" description={data ? `Only send ${data.tokens.map(tokenLabel).join(", ")} on ${chainLabel(data.chain)}.` : undefined}>
        {shown && (data ? <ReceiveAddress key={data.address} data={data} /> : loadError ? (
          <div className="flex flex-col gap-3">
            <p role="alert" className="text-sm text-danger">{loadError}</p>
            <Button variant="ghost" onClick={() => setAttempt((n) => n + 1)}>Retry</Button>
          </div>
        ) : <p role="status" className="py-5 text-center text-sm text-muted">Loading your address…</p>)}
      </DrawerContent>
    </Drawer>
  );
}

function ReceiveAddress({ data }: { data: ReceiveIsland }) {
  const [error, setError] = React.useState("");
  const [copied, setCopied] = React.useState(false);
  React.useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1600);
    return () => clearTimeout(timer);
  }, [copied]);

  async function copy() {
    setError("");
    setCopied(false);
    try {
      await navigator.clipboard.writeText(data.address);
      setCopied(true);
    } catch {
      setError("Couldn't copy your address. Select the address to copy it manually.");
    }
  }

  async function share() {
    if (!navigator.share) return copy();
    setError("");
    try {
      await navigator.share({ title: "My Arcie address", text: data.address });
    } catch (e) {
      if (e instanceof Error && e.name === "AbortError") return;
      setError("Couldn't share your address. You can copy it instead.");
    }
  }

  return (
    <div className="flex flex-col items-center gap-5 pb-2">
      <div className="grid size-[248px] place-items-center rounded-3xl bg-white p-4">
        <QRCodeSVG value={data.address} title="Wallet address QR code" size={216} level="M" marginSize={0} />
      </div>
      <p className="select-all break-all px-2 text-center font-mono text-[13px] leading-relaxed text-muted">{data.address}</p>
      {error ? <p role="alert" className="text-sm text-danger">{error}</p> : null}
      <div className="grid w-full grid-cols-2 gap-3">
        <Button size="lg" variant="ghost" onClick={copy}>
          {copied ? <IconCheck className="size-5 text-success" /> : <IconCopy className="size-5" />}
          {copied ? "Copied" : "Copy"}
        </Button>
        <Button size="lg" variant="light" onClick={share}>
          <IconShare className="size-5" /> Share
        </Button>
      </div>
    </div>
  );
}
