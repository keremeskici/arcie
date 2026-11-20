import type { IslandPayload } from "@arcie/core";
import * as React from "react";
import { Button } from "@/components/Button";
import { Drawer, DrawerContent } from "@/components/ui/drawer";
import { api, type Contact } from "@/lib/api";
import { cn } from "@/lib/cn";
import { isAddress, shortAddress } from "@/lib/format";
import { useIslands } from "@/lib/islands";
import { TokenIcon, tokenLabel } from "@/lib/tokens";

const TOKENS = ["USDC", "EURC"] as const;

/**
 * Tap-to-send. This only *proposes*: the server answers with the same confirm card the voice agent
 * produces, and nothing moves until the user confirms it (spec §8.3, §11 POST /intents).
 */
export function SendSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { push } = useIslands();
  const [to, setTo] = React.useState("");
  const [amount, setAmount] = React.useState("");
  const [token, setToken] = React.useState<(typeof TOKENS)[number]>("USDC");
  const [contacts, setContacts] = React.useState<Contact[]>([]);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    setError(null);
    api.get<{ contacts: Contact[] }>("/contacts").then((r) => setContacts(r.contacts), () => setContacts([]));
  }, [open]);

  const validAmount = /^\d*\.?\d+$/.test(amount) && Number(amount) > 0;
  const recipient = to.trim();
  const canSubmit = recipient.length > 0 && validAmount && !busy;
  const looksLikeAddress = recipient.startsWith("0x");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    if (looksLikeAddress && !isAddress(recipient)) return setError("That address doesn't look complete.");
    setBusy(true);
    setError(null);
    try {
      const r = await api.post<{ island?: IslandPayload }>("/intents", { kind: "send", params: { to: recipient, amount, token } });
      if (r.island) push(r.island);
      onOpenChange(false);
      setTo("");
      setAmount("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't prepare that send.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent title="Send" description="Send money to a wallet address or a contact.">
        <form onSubmit={submit} className="flex flex-col gap-5">
          <div className="flex flex-col items-center gap-3 py-2">
            <div className="flex items-baseline gap-2">
              <input
                className="w-[7ch] bg-transparent text-center text-5xl font-semibold tabular-nums outline-none placeholder:text-white/20"
                inputMode="decimal"
                placeholder="0"
                value={amount}
                onChange={(e) => setAmount(e.target.value.replace(",", ".").replace(/[^\d.]/g, ""))}
                aria-label="Amount"
              />
            </div>
            <div className="flex rounded-full bg-card-2 p-1">
              {TOKENS.map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setToken(t)}
                  className={cn(
                    "flex items-center gap-1.5 rounded-full py-1.5 pl-1.5 pr-4 text-sm font-medium",
                    token === t ? "bg-white text-black" : "text-muted",
                  )}
                >
                  <TokenIcon symbol={t} size={20} />
                  {tokenLabel(t)}
                </button>
              ))}
            </div>
          </div>

          <label className="flex flex-col gap-2">
            <span className="text-sm text-muted">To</span>
            <input
              className="h-14 rounded-2xl border border-line bg-bg px-4 font-mono text-[15px] outline-none focus:border-accent"
              placeholder="0x… or a contact name"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              value={to}
              onChange={(e) => setTo(e.target.value)}
            />
          </label>

          {contacts.length ? (
            <div className="-mt-2 flex flex-wrap gap-2">
              {contacts.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setTo(c.name)}
                  className={cn(
                    "rounded-full border px-3 py-1.5 text-sm",
                    to === c.name ? "border-accent bg-accent/15 text-fg" : "border-line text-muted",
                  )}
                >
                  {c.name} <span className="text-xs opacity-60">{shortAddress(c.address)}</span>
                </button>
              ))}
            </div>
          ) : null}

          {error ? <p className="text-sm text-danger">{error}</p> : null}

          <Button type="submit" size="lg" variant="light" disabled={!canSubmit}>
            {busy ? "Preparing…" : "Review"}
          </Button>
          <p className="-mt-2 text-center text-xs text-muted">You'll see every detail before anything is sent.</p>
        </form>
      </DrawerContent>
    </Drawer>
  );
}
