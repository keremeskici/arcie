import {
  IconAddressBook, IconArrowDownLeft, IconArrowUpRight, IconArrowsExchange,
  IconChevronRight, IconHistory, IconLogout, IconMessageCircle, IconPlus,
  IconRefresh, IconWaveSine,
} from "@tabler/icons-react";
import * as React from "react";
import { SavingsIsland } from "@/components/SavingsIsland";
import { SiriOrb } from "@/components/ui/siri-orb";
import { api, type AuthSession, type Balances } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/cn";
import { tokenAmount, usd } from "@/lib/format";
import { useIslands } from "@/lib/islands";
import { TokenIcon, tokenLabel } from "@/lib/tokens";
import { useVoiceAccess } from "@/lib/voice-access";

export type WalletTool = "onramp" | "swap" | "account" | "contacts" | "activity" | "chat";

export function WalletScreen({
  account,
  onSend,
  onReceive,
  onVoice,
  onTool,
}: {
  account: AuthSession;
  onSend: () => void;
  onReceive: () => void;
  onVoice: React.MouseEventHandler<HTMLButtonElement>;
  onTool: (tool: WalletTool) => void;
}) {
  const { logout, mode } = useAuth();
  const { balanceTick } = useIslands();
  const voiceInBackground = useVoiceAccess()?.inBackground;
  const [balances, setBalances] = React.useState<Balances | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const [refresh, setRefresh] = React.useState(0);
  React.useEffect(() => {
    let current = true;
    setLoading(true);
    api.get<Balances>("/balances")
      .then(b => { if (current) { setBalances(b); setError(null); } })
      .catch((e: unknown) => { if (current) setError(e instanceof Error ? e.message : "Couldn't load your balance."); })
      .finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [balanceTick, refresh]);

  const tokens = balances?.chains[0]?.tokens ?? [];
  const name = account.user.displayName?.split(" ")[0] || "there";

  return (
    <main className="phone wallet-home px-5">
      <header className="flex items-center justify-between pt-3">
        <button aria-label="Account" onClick={() => onTool("account")} className="flex min-h-11 items-center gap-2.5 rounded-full text-left">
          <span className="wallet-avatar grid size-8 place-items-center rounded-full text-sm font-semibold">
            {name.slice(0, 1).toUpperCase()}
          </span>
          <span className="text-[15px] font-medium">Hi, {name}</span>
          <IconChevronRight className="size-3.5 text-muted" aria-hidden="true" />
        </button>
        <div className="flex">
          {mode !== "demo" && <IconButton label="Message Arcie" icon={IconMessageCircle} onClick={() => onTool("chat")} />}
          <IconButton label="Sign out" icon={IconLogout} onClick={() => void logout()} />
        </div>
      </header>

      <div className="wallet-voice">
        <button type="button" onClick={onVoice} aria-haspopup="dialog"
          aria-description={voiceInBackground ? "Your voice conversation is still open." : undefined}
          className="group mx-auto flex w-fit flex-col items-center rounded-2xl">
          <span className="wallet-orb-stage" aria-hidden="true">
            <span className="wallet-orb-core">
              <SiriOrb size="100px" animationDuration={14} colors={{ bg: "#13121c" }} />
            </span>
          </span>
          <span className="flex h-11 items-center justify-center gap-2 px-4 text-[19px] font-medium tracking-tight">
            <IconWaveSine size={20} stroke={1.8} className="text-[#baabfa]" aria-hidden="true" />
            {voiceInBackground ? "Return to voice" : "Talk to Arcie"}
          </span>
        </button>
      </div>

      <section aria-labelledby="balance-title" className="wallet-balance">
        <div className="flex items-center justify-between gap-2 px-5 pt-2">
          <div className="flex items-center gap-1">
            <h1 id="balance-title" className="text-sm font-medium text-[#c4c1ce]">Wallet balance</h1>
            <button aria-label="Refresh balance" title="Refresh balance" onClick={() => setRefresh(value => value + 1)}
              className="grid size-11 place-items-center rounded-full text-muted hover:text-fg">
              <IconRefresh size={15} className={cn(loading && "motion-safe:animate-spin")} aria-hidden="true" />
            </button>
          </div>
          <div role="group" aria-label="Wallet shortcuts" className="flex">
            <IconButton label="Contacts" icon={IconAddressBook} onClick={() => onTool("contacts")} />
            <IconButton label="Activity" icon={IconHistory} onClick={() => onTool("activity")} />
          </div>
        </div>
        <div className="px-5 pb-5">
          <p className="text-[clamp(2.25rem,11vw,3.25rem)] font-medium leading-none tracking-[-0.055em] tabular-nums">
            {balances ? usd(balances.totalUsd ?? balances.knownSubtotalUsd) : <span className="text-muted">$—</span>}
          </p>
          {balances && balances.totalUsd === null && (
            <p className="mt-2 text-xs text-muted">
              Plus {tokens.filter(t => t.usd === null).map(t => `${tokenAmount(t.amount)} ${tokenLabel(t.token)}`).join(", ")} (price unavailable)
            </p>
          )}
          {error && <p role="alert" className="mt-2 text-sm text-danger">{error}</p>}
        </div>

        <div role="group" aria-label="Money actions" className="mx-3 grid grid-cols-4 border-t border-white/[0.08] pb-2 pt-2">
          <MoneyAction icon={IconPlus} label="Add money" onClick={() => onTool("onramp")} primary />
          <MoneyAction icon={IconArrowUpRight} label="Send" onClick={onSend} />
          <MoneyAction icon={IconArrowDownLeft} label="Receive" onClick={onReceive} />
          <MoneyAction icon={IconArrowsExchange} label="Swap" onClick={() => onTool("swap")} />
        </div>
      </section>

      <SavingsIsland walletDollars={balances ? tokens.find(t => t.token === "USDC")?.amount ?? "0" : null} />

      {tokens.length > 0 && (
        <section aria-labelledby="currencies-title" className="mb-6 mt-6">
          <h2 id="currencies-title" className="mb-1.5 px-1 text-[15px] font-medium">Currencies</h2>
          <ul className="divide-y divide-line">
            {tokens.map(t => (
              <li key={t.token} className="flex items-center justify-between gap-3 px-1 py-3">
                <div className="flex items-center gap-3">
                  <TokenIcon symbol={t.token} size={32} />
                  <div>
                    <p className="font-medium leading-tight">{tokenLabel(t.token)}</p>
                    <p className="text-xs text-muted tabular-nums">
                      <span className="sr-only">Unit price </span>{usd(t.token === "USDC" ? 1 : t.usdPrice)}
                    </p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="font-medium tabular-nums"><span className="sr-only">Value in USD </span>{usd(t.usd)}</p>
                  <p className="text-xs text-muted tabular-nums"><span className="sr-only">Units held </span>{tokenAmount(t.amount)}</p>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}

type WalletButtonProps = { icon: typeof IconPlus; label: string; onClick: () => void };

function IconButton({ icon: Icon, label, onClick }: WalletButtonProps) {
  return (
    <button type="button" onClick={onClick} aria-label={label} title={label}
      className="grid size-11 place-items-center rounded-full text-[#c9c6d3] transition-colors hover:bg-white/6 hover:text-white active:bg-white/10">
      <Icon size={19} stroke={1.65} aria-hidden="true" />
    </button>
  );
}

function MoneyAction({ icon: Icon, label, onClick, primary }: WalletButtonProps & { primary?: boolean }) {
  return (
    <button type="button" onClick={onClick} className="group flex min-h-16 min-w-0 flex-col items-center justify-center gap-1.5 rounded-2xl py-2 text-[12px] font-medium">
      <span className={cn("grid size-9 place-items-center rounded-full transition group-active:scale-95",
        primary ? "bg-[#dbd1ff] text-[#251c3b] group-hover:bg-[#e6deff]"
          : "bg-white/[0.07] text-[#efedf5] group-hover:bg-white/[0.12]")}>
        <Icon size={18} stroke={1.85} aria-hidden="true" />
      </span>
      {label}
    </button>
  );
}
