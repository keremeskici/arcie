import type { AgentLimits } from "@arcie/core";
import { IconChevronDown, IconChevronRight, IconPlus } from "@tabler/icons-react";
import * as React from "react";
import { Button } from "@/components/Button";
import { Drawer, DrawerContent } from "@/components/ui/drawer";
import { api, type AuthSession, type Contact } from "@/lib/api";
import { chainLabel, isAddress, shortAddress, usd } from "@/lib/format";
import { tokenLabel } from "@/lib/tokens";
import { actionLabels, DetailRow, SheetFeedback, useSheetData, type SheetProps } from "./AccountSheetParts";

export { ActivitySheet } from "./ActivitySheet";

type Account = {
  user: AuthSession["user"] & { homeChain: string; linkedWallet: string | null };
  wallets: AuthSession["wallet"][];
  limits: AgentLimits & { source: "db" | "ens" };
};

export function AccountSheet({ onClose }: SheetProps) {
  const resource = useSheetData<Account>("/me");
  const account = resource.data;
  return (
    <Drawer open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DrawerContent title="Account">
        <SheetFeedback resource={resource} label="account" />
        {account && (
          <div className="space-y-5">
            <dl className="divide-y divide-line">
              <DetailRow label="Name">{account.user.displayName || "—"}</DetailRow>
              <DetailRow label="Account ID">{account.user.id}</DetailRow>
              {account.user.email && <DetailRow label="Email">{account.user.email}</DetailRow>}
              <DetailRow label="Home network">{chainLabel(account.user.homeChain)}</DetailRow>
              {account.user.linkedWallet && <DetailRow label="Sign-in address">{account.user.linkedWallet}</DetailRow>}
            </dl>
            <section>
              <h3 className="mb-2 font-semibold">Wallets</h3>
              {account.wallets.length ? account.wallets.map((w) => (
                <div key={w.address + w.chain} className="mb-2 rounded-2xl border border-line bg-bg/60 p-3">
                  <p className="text-xs text-muted">{chainLabel(w.chain)}</p>
                  <p className="mt-1 select-all break-all font-mono text-sm">{w.address}</p>
                </div>
              )) : <p className="text-sm text-muted">No wallets yet.</p>}
            </section>
            <section>
              <h3 className="font-semibold">Transaction limits</h3>
              <dl className="divide-y divide-line">
                <DetailRow label="Per transaction">{usd(account.limits.maxPerTxUsd)}</DetailRow>
                <DetailRow label="Daily limit">{usd(account.limits.dailyCapUsd)}</DetailRow>
                <DetailRow label="Allowed actions">{account.limits.allowedActions.map((k) => actionLabels[k]).join(", ") || "None"}</DetailRow>
                <DetailRow label="Allowed currencies">{account.limits.allowedTokens.map(tokenLabel).join(", ") || "None"}</DetailRow>
                <DetailRow label="Maximum slippage">{account.limits.maxSlippageBps / 100}%</DetailRow>
                <DetailRow label="On-screen review for new recipients">{account.limits.newRecipientRequiresScreen ? "Required" : "Optional"}</DetailRow>
                <DetailRow label="Policy source">{account.limits.source === "ens" ? "ENS" : "Account database"}</DetailRow>
              </dl>
            </section>
          </div>
        )}
      </DrawerContent>
    </Drawer>
  );
}

const inputClass = "mt-1.5 w-full rounded-xl border border-line bg-bg/60 px-3 py-3 text-fg outline-none focus-visible:ring-2 focus-visible:ring-accent";

export function ContactsSheet({ onClose }: SheetProps) {
  const resource = useSheetData<{ contacts: Contact[] }>("/contacts");
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [adding, setAdding] = React.useState(false);
  function saved(contact: Contact) {
    resource.setData((old) => ({ contacts: [...(old?.contacts ?? []), contact] }));
    setSelectedId(contact.id);
    setAdding(false);
  }
  return (
    <Drawer open onOpenChange={(open) => { if (!open) onClose(); }} voiceHandoff="contacts">
      <DrawerContent title={adding ? "Add contact" : "Contacts"}>
        <SheetFeedback resource={resource} label="contacts" />
        {resource.data && (adding ? <ContactForm contacts={resource.data.contacts} onSaved={saved} onBack={() => setAdding(false)} /> : (
          <div className="space-y-4">
            {resource.data.contacts.length ? (
              <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-bg/60">
                {resource.data.contacts.map((contact) => {
                  const selected = selectedId === contact.id;
                  return <li key={contact.id}>
                    <button type="button" aria-expanded={selected} onClick={() => setSelectedId(selected ? null : contact.id)}
                      className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left active:bg-card-2">
                      <span className="min-w-0 break-words font-medium">{contact.name}</span>
                      <span className="flex shrink-0 items-center gap-2 font-mono text-xs text-muted">
                        {shortAddress(contact.address)}{selected ? <IconChevronDown size={16} /> : <IconChevronRight size={16} />}
                      </span>
                    </button>
                    {selected && <div className="px-4 pb-3">
                      <p className="text-xs text-muted">{chainLabel(contact.chain)}</p>
                      <p className="mt-1 select-all break-all font-mono text-sm">{contact.address}</p>
                    </div>}
                  </li>;
                })}
              </ul>
            ) : <p className="py-2 text-sm text-muted">No contacts yet.</p>}
            <Button variant="light" className="w-full" onClick={() => setAdding(true)}><IconPlus size={18} /> Add contact</Button>
          </div>
        ))}
      </DrawerContent>
    </Drawer>
  );
}

function ContactForm({ contacts, onSaved, onBack }: { contacts: Contact[]; onSaved: (contact: Contact) => void; onBack: () => void }) {
  const [name, setName] = React.useState("");
  const [address, setAddress] = React.useState("");
  const [error, setError] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const saving = React.useRef(false);
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (saving.current) return;
    const cleanName = name.trim();
    const cleanAddress = address.trim();
    if (!cleanName || cleanName.length > 60) return setError("Enter a name between 1 and 60 characters.");
    if (contacts.some((c) => c.name === cleanName)) return setError("You already have a contact with that name.");
    if (!isAddress(cleanAddress)) return setError("Enter a full wallet address starting with 0x.");
    saving.current = true;
    setBusy(true);
    setError("");
    try {
      const { contact } = await api.post<{ contact: Contact }>("/contacts", { name: cleanName, address: cleanAddress });
      onSaved(contact);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn’t save this contact.");
    } finally {
      saving.current = false;
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit} className="space-y-4">
      <label className="block text-sm text-muted">Name
        <input value={name} maxLength={60} disabled={busy} autoComplete="off" className={inputClass}
          onChange={(e) => { setName(e.target.value); setError(""); }} />
      </label>
      <label className="block text-sm text-muted">Wallet address
        <input value={address} disabled={busy} autoCapitalize="none" autoCorrect="off" autoComplete="off" spellCheck={false}
          className={inputClass + " font-mono"} placeholder="0x…" onChange={(e) => { setAddress(e.target.value); setError(""); }} />
      </label>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      <div className="grid grid-cols-[1fr_1.5fr] gap-3">
        <Button variant="outline" disabled={busy} onClick={onBack}>Back</Button>
        <Button type="submit" variant="light" aria-busy={busy} disabled={busy}>{busy ? "Saving…" : "Save contact"}</Button>
      </div>
    </form>
  );
}
