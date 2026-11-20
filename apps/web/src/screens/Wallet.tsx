import { IconArrowDownLeft, IconArrowUpRight, IconLogout, IconRefresh } from "@tabler/icons-react";
import * as React from "react";
import { SiriOrb } from "@/components/ui/siri-orb";
import { api, type AuthSession, type Balances } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/cn";
import { chainLabel, shortAddress, tokenAmount, usd } from "@/lib/format";
import { useIslands } from "@/lib/islands";
import { TokenIcon, tokenLabel } from "@/lib/tokens";

export function WalletScreen({
  account,
  onSend,
  onReceive,
  onVoice,
}: {
  account: AuthSession;
  onSend: () => void;
  onReceive: () => void;
  onVoice: () => void;
}) {
  const { logout } = useAuth();
  const { balanceTick } = useIslands();
  const [balances, setBalances] = React.useState<Balances | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const load = React.useCallback(() => {
    setLoading(true);
    api
      .get<Balances>("/balances")
      .then((b) => (setBalances(b), setError(null)))
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Couldn't load your balance."))
      .finally(() => setLoading(false));
  }, []);

  React.useEffect(load, [load, balanceTick]);

  const tokens = balances?.chains[0]?.tokens ?? [];
  const name = account.user.displayName?.split(" ")[0] ?? "there";

  return (
    <div className="phone px-5">
      <header className="flex items-center justify-between pb-2 pt-5">
        <div className="flex items-center gap-3">
          <div className="grid size-10 place-items-center rounded-full bg-card-2 text-sm font-semibold">
            {name.slice(0, 1).toUpperCase()}
          </div>
          <div>
            <p className="text-[15px] font-medium leading-tight">Hi, {name}</p>
            <p className="text-xs text-muted">{shortAddress(account.wallet.address)}</p>
          </div>
        </div>
        <button
          className="grid size-10 place-items-center rounded-full text-muted active:bg-card"
          onClick={() => void logout()}
          aria-label="Sign out"
        >
          <IconLogout className="size-5" />
        </button>
      </header>

      <section className="mt-4 rounded-[1.75rem] border border-line bg-gradient-to-b from-card-2 to-card p-6">
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted">Balance</span>
          <button
            className="flex items-center gap-1.5 rounded-full bg-white/5 px-2.5 py-1 text-xs text-muted"
            onClick={load}
            aria-label="Refresh balance"
          >
            <span className="size-1.5 rounded-full bg-success" />
            {chainLabel(account.wallet.chain)}
            <IconRefresh className={cn("size-3.5", loading && "animate-spin")} />
          </button>
        </div>
        <p className="mt-3 text-[44px] font-semibold leading-none tracking-tight tabular-nums">
          {balances ? usd(balances.totalUsd ?? balances.knownSubtotalUsd) : <span className="text-muted">$—</span>}
        </p>
        {balances && balances.totalUsd === null ? (
          <p className="mt-2 text-xs text-muted">
            Plus {tokens.filter((t) => t.usd === null).map((t) => `${tokenAmount(t.amount)} ${tokenLabel(t.token)}`).join(", ")} (price unavailable)
          </p>
        ) : null}
        {error ? <p className="mt-2 text-sm text-danger">{error}</p> : null}

        <div className="mt-6 grid grid-cols-2 gap-3">
          <ActionButton icon={<IconArrowUpRight className="size-5" />} label="Send" onClick={onSend} />
          <ActionButton icon={<IconArrowDownLeft className="size-5" />} label="Receive" onClick={onReceive} />
        </div>
      </section>

      <section className="mt-5">
        <ul className="divide-y divide-line rounded-2xl border border-line bg-card">
          {(tokens.length ? tokens : [{ token: "USDC", amount: "0", usd: 0 }]).map((t) => (
            <li key={t.token} className="flex items-center justify-between px-4 py-3.5">
              <div className="flex items-center gap-3">
                <TokenIcon symbol={t.token} size={32} />
                <span className="font-medium">{tokenLabel(t.token)}</span>
              </div>
              <div className="text-right">
                <p className="font-medium tabular-nums">{tokenAmount(t.amount)}</p>
                <p className="text-xs text-muted tabular-nums">{usd(t.usd)}</p>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <div className="flex flex-1 flex-col items-center justify-end pb-10 pt-8">
        <button
          onClick={onVoice}
          className="group relative grid place-items-center rounded-full outline-none focus-visible:ring-4 focus-visible:ring-[var(--ring)]"
          aria-label="Talk to Arcie"
        >
          <span className="absolute inset-[-14px] animate-pulse rounded-full bg-accent/15 blur-xl" />
          <span className="relative rounded-full p-1.5 ring-1 ring-white/10 transition-transform group-active:scale-95">
            <SiriOrb size="132px" animationDuration={12} colors={{ bg: "#0a0a0f" }} />
          </span>
        </button>
        <p className="mt-5 text-[15px] font-medium">Tap to talk</p>
        <p className="mt-1 text-sm text-muted">“Send 5 dollars to Savings”</p>
      </div>
    </div>
  );
}

function ActionButton({ icon, label, onClick }: { icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="flex h-14 items-center justify-center gap-2 rounded-2xl bg-white text-[15px] font-semibold text-black transition-transform active:scale-[0.97]"
    >
      {icon}
      {label}
    </button>
  );
}
