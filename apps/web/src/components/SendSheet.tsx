import type { IslandPayload, TokenSymbol } from "@arcie/core";
import { IconAddressBook, IconArrowLeft, IconCheck, IconLoader2 } from "@tabler/icons-react";
import * as React from "react";
import { Button } from "@/components/Button";
import { Drawer, DrawerContent } from "@/components/ui/drawer";
import { api, type Contact } from "@/lib/api";
import { cn } from "@/lib/cn";
import { isAddress } from "@/lib/format";
import { useIslands } from "@/lib/islands";
import { enteredAmount, TokenIcon, tokenLabel, walletCurrencies } from "@/lib/tokens";
import { SheetFeedback, useSheetData } from "./AccountSheetParts";

export function SendSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { push } = useIslands();
  const [to, setTo] = React.useState("");
  const [contact, setContact] = React.useState<Contact | null>(null);
  const [picking, setPicking] = React.useState(false);
  const [amount, setAmount] = React.useState("");
  const [sendAll, setSendAll] = React.useState(false);
  const [maximum, setMaximum] = React.useState<{ recipient: string; token: TokenSymbol; amount: string; feeChecked: boolean; error?: string } | null>(null);
  const [quoteAttempt, setQuoteAttempt] = React.useState(0);
  const [token, setToken] = React.useState<TokenSymbol>("USDC");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");
  const submitting = React.useRef(false);
  const chooseButton = React.useRef<HTMLButtonElement>(null);
  const recipient = contact?.id ?? to.trim();
  const quote = sendAll && maximum?.recipient === recipient && maximum.token === token ? maximum : null;
  const quoting = sendAll && !quote;
  const displayed = sendAll ? quote?.amount ?? "" : amount;
  const validAmount = enteredAmount(displayed, token);
  const canSubmit = !!recipient && validAmount !== null && (!sendAll || quote?.feeChecked) && !busy;

  React.useEffect(() => {
    if (!sendAll || !open) return;
    let current = true;
    async function refresh() {
      const query = new URLSearchParams({ token });
      if (recipient) query.set("to", recipient);
      try {
        const result = await api.get<{ amount: string; feeChecked: boolean }>(`/quotes/send-max?${query}`);
        if (current) setMaximum({ recipient, token, ...result });
      } catch (e) {
        if (current) setMaximum({ recipient, token, amount: "", feeChecked: false,
          error: e instanceof Error ? e.message : "Couldn't calculate the maximum." });
      }
    }
    // A typed contact name can take multiple keystrokes. A selection already has an exact ID.
    const timer = window.setTimeout(refresh, recipient && !contact ? 180 : 0);
    return () => { current = false; window.clearTimeout(timer); };
  }, [contact, open, quoteAttempt, recipient, sendAll, token]);

  function exitMaximum() {
    setMaximum(null);
    setSendAll(false);
    setError("");
  }

  function changeRecipient(value: string, selected: Contact | null) {
    if ((selected?.id ?? value.trim()) !== recipient) setMaximum(null);
    setError("");
    setContact(selected);
    setTo(value);
  }

  function close() {
    if (submitting.current) return;
    exitMaximum();
    setPicking(false);
    onOpenChange(false);
  }

  function returnFromPicker(selected?: Contact) {
    if (selected && selected.id !== contact?.id) changeRecipient(selected.name, selected);
    setPicking(false);
    requestAnimationFrame(() => chooseButton.current?.focus());
  }

  function toggleMaximum() {
    if (sendAll) { exitMaximum(); return; }
    setError("");
    setAmount("");
    setMaximum(null);
    setSendAll(true);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit || submitting.current) return;
    if (recipient.startsWith("0x") && !isAddress(recipient)) return setError("That address doesn't look complete.");
    submitting.current = true;
    setBusy(true);
    setError("");
    try {
      const r = await api.post<{ island?: IslandPayload }>("/intents", { kind: "send", params: { to: recipient, amount: sendAll ? "all" : validAmount, token } });
      if (!r.island) throw new Error("Couldn't prepare that send. Please try again.");
      push(r.island);
      onOpenChange(false);
      setTo("");
      setContact(null);
      setAmount("");
      setSendAll(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't prepare that send.");
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }

  return (
    <Drawer open={open} onOpenChange={(next) => { if (!next) picking ? returnFromPicker() : close(); }}>
      <DrawerContent title={picking ? "Choose contact" : "Send"} showClose={!busy}>
        {picking ? <RecipientPicker selected={contact?.id} onBack={() => returnFromPicker()} onPick={returnFromPicker} /> : (
          <form onSubmit={submit} className="flex flex-col gap-5">
            <div className="flex flex-col items-center gap-3 py-2">
              <input className="w-full bg-transparent text-center text-[clamp(1.8rem,9vw,3rem)] font-semibold tabular-nums outline-none placeholder:text-white/20"
                inputMode="decimal" placeholder="0" value={displayed} disabled={busy} aria-label="Amount"
                onChange={(e) => { exitMaximum(); setAmount(e.target.value); }} />
              <button type="button" aria-pressed={sendAll} disabled={busy || quoting} aria-busy={quoting} onClick={toggleMaximum}
                className="rounded-full bg-card-2 px-3.5 py-2 text-sm font-medium text-accent aria-pressed:bg-accent/15">
                {quoting ? "Calculating…" : "Send all"}
              </button>
              {sendAll && quote && !quote.error && !recipient && (
                <p className="text-center text-xs text-muted" role="status">
                  {token === "USDC" ? "Balance before the network fee." : "Choose a recipient to check the network fee."}
                </p>
              )}
              <div className="flex rounded-full bg-card-2 p-1">
                {walletCurrencies.map((t) => (
                  <button key={t} type="button" disabled={busy} aria-pressed={token === t}
                    onClick={() => { if (token !== t) { setMaximum(null); setError(""); setToken(t); } }}
                    className={cn("flex items-center gap-1.5 rounded-full py-1.5 pl-1.5 pr-4 text-sm font-medium", token === t ? "bg-white text-black" : "text-muted")}>
                    <TokenIcon symbol={t} size={20} />{tokenLabel(t)}
                  </button>
                ))}
              </div>
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-3">
                <label htmlFor="send-recipient" className="text-sm text-muted">To</label>
                <button ref={chooseButton} type="button" onClick={() => setPicking(true)} disabled={busy}
                  className="flex min-h-10 items-center gap-1.5 px-1 text-sm font-medium text-accent">
                  <IconAddressBook size={17} /> Contacts
                </button>
              </div>
              <input id="send-recipient" className="h-14 w-full rounded-2xl border border-line bg-bg px-4 text-[15px] outline-none focus:border-accent"
                placeholder="0x… or a contact name" autoCapitalize="off" autoCorrect="off" spellCheck={false} value={to} disabled={busy}
                onChange={(e) => changeRecipient(e.target.value, null)} />
              {contact && <p className="break-all font-mono text-xs text-muted">{contact.address}</p>}
            </div>
            {quote?.error && <div className="space-y-2">
              <p role="alert" className="text-sm text-danger">{quote.error}</p>
              <Button onClick={() => { setMaximum(null); setQuoteAttempt(v => v + 1); }} variant="ghost">Retry amount</Button>
            </div>}
            {error && <p role="alert" className="text-sm text-danger">{error}</p>}
            <Button type="submit" size="lg" variant="light" disabled={!canSubmit} aria-busy={busy}>
              {busy && <IconLoader2 className="size-5 motion-safe:animate-spin" aria-hidden="true" />}
              {busy ? "Preparing…" : "Review"}
            </Button>
          </form>
        )}
      </DrawerContent>
    </Drawer>
  );
}

function RecipientPicker({ selected, onPick, onBack }: { selected?: string; onPick: (c: Contact) => void; onBack: () => void }) {
  const resource = useSheetData<{ contacts: Contact[] }>("/contacts");
  const back = React.useRef<HTMLButtonElement>(null);
  React.useEffect(() => { back.current?.focus(); }, []);
  return <div className="space-y-3">
    <Button ref={back} variant="outline" onClick={onBack}><IconArrowLeft size={16} /> Back to send</Button>
    <SheetFeedback resource={resource} label="contacts" />
    {resource.data && (resource.data.contacts.length ? (
      <ul className="divide-y divide-line rounded-2xl border border-line">
        {resource.data.contacts.map(c => <li key={c.id}>
          <button type="button" onClick={() => onPick(c)} aria-pressed={c.id === selected} className="w-full px-4 py-3 text-left active:bg-card-2">
            <span className="flex items-center justify-between font-medium">{c.name}{c.id === selected && <IconCheck size={16} />}</span>
            <span className="mt-1 block break-all font-mono text-xs text-muted">{c.address}</span>
          </button>
        </li>)}
      </ul>
    ) : <p className="text-sm text-muted">No contacts yet. Enter a wallet address to send money.</p>)}
  </div>;
}
