import { IconPigMoney, IconPlus, IconRefresh } from "@tabler/icons-react";
import * as React from "react";
import { Button } from "@/components/Button";
import { DepositSheet, type SavingsDirection } from "@/components/DepositSheet";
import { api, type SavingsAccount } from "@/lib/api";
import { usd } from "@/lib/format";
import { useIslands } from "@/lib/islands";

const ratePercent = new Intl.NumberFormat("en-US", { style: "percent", maximumFractionDigits: 2 });

function cashAmount(value: number | null) {
  return value !== null && value > 0 && value < 0.01 ? "Less than 1¢" : usd(value);
}

export function SavingsIsland({ walletDollars = null }: { walletDollars?: string | null }) {
  const { balanceTick } = useIslands();
  const [account, setAccount] = React.useState<SavingsAccount | null>(null);
  const [direction, setDirection] = React.useState<SavingsDirection | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [retry, setRetry] = React.useState(0);

  React.useEffect(() => {
    let active = true;
    setLoading(true);
    api.get<SavingsAccount>("/savings")
      .then((result) => { if (active) setAccount(result); })
      .catch(() => { if (active) setAccount(null); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [balanceTick, retry]);

  const balance = account?.balance == null ? null : Number(account.balance);
  const earnings = account?.earned == null ? null : Number(account.earned);
  return (
    <>
      <section aria-labelledby="savings-title" aria-busy={loading}
        className="mt-4 rounded-[20px] border border-[#c8b9e8]/10 bg-[#1b1921] px-4 py-3.5">
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
          <h2 id="savings-title" className="flex items-center gap-2 text-[15px] font-medium">
            <IconPigMoney className="size-[19px] text-[#bcacd7]" stroke={1.6} aria-hidden="true" /> Savings
          </h2>
          <div className="flex flex-wrap items-center gap-1">
            {balance !== null && balance > 0 && <Button variant="outline" className="h-11 rounded-full border-white/10 px-3.5 text-sm"
              disabled={!account?.available || loading} onClick={() => setDirection("withdraw")}>Withdraw</Button>}
            <Button variant="light" className="h-11 gap-1 rounded-full bg-[#e7dff3] px-3.5 text-sm text-[#27212d]"
              disabled={!account?.available || loading} onClick={() => setDirection("deposit")}>
              <IconPlus size={15} stroke={2} aria-hidden="true" /> Deposit
            </Button>
          </div>
        </div>
        <p className="mt-1 text-[28px] font-medium leading-tight tracking-tight tabular-nums">
          <span className="sr-only">Savings balance </span><span>{cashAmount(balance)}</span>
        </p>
        {account?.available ? (
          <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] leading-5 text-[#bcb4c6]">
            <span>{account.annualRate === null ? "Annual rate unavailable" : `${ratePercent.format(account.annualRate)} variable annual rate`}</span>
            {earnings !== null && <>
              <span aria-hidden="true" className="size-0.5 rounded-full bg-current opacity-60" />
              <span>{cashAmount(Math.abs(earnings))} {earnings < 0 ? "lost" : "earned"}</span>
            </>}
          </p>
        ) : loading ? (
          <p className="mt-1 text-sm text-muted">Loading savings…</p>
        ) : (
          <div className="flex items-center justify-between text-sm text-muted">
            <span>Savings unavailable</span>
            <button aria-label="Retry savings" onClick={() => setRetry((value) => value + 1)}
              className="flex min-h-10 items-center gap-1.5 rounded-lg px-2 text-[#c8b9e8]">
              <IconRefresh size={14} aria-hidden="true" /> Retry
            </button>
          </div>
        )}
      </section>
      {direction && <DepositSheet direction={direction}
        balance={direction === "withdraw" ? account?.balance ?? null : walletDollars} annualRate={account?.annualRate ?? null}
        available={!!account?.available} onClose={() => setDirection(null)} />}
    </>
  );
}
