import { parseAmount, type IslandPayload } from "@arcie/core";
import { IconLoader2 } from "@tabler/icons-react";
import * as React from "react";
import { Button } from "@/components/Button";
import { SavingsProjection } from "@/components/SavingsProjection";
import { Drawer, DrawerContent } from "@/components/ui/drawer";
import { api, ApiError } from "@/lib/api";
import { savingsDollars } from "@/lib/format";
import { useIslands } from "@/lib/islands";
import { enteredAmount } from "@/lib/tokens";

export type SavingsDirection = "deposit" | "withdraw";
const quickAmounts = [1, 5, 10, 25, 50];

export function DepositSheet({ direction, balance, annualRate, available, onClose }: {
  direction: SavingsDirection; balance: string | null; annualRate: number | null; available: boolean; onClose: () => void;
}) {
  const { push } = useIslands();
  const amountId = React.useId();
  const [amount, setAmount] = React.useState("");
  const [withdrawAll, setWithdrawAll] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const submitting = React.useRef(false);
  const withdrawing = direction === "withdraw";
  const action = withdrawing ? "withdrawal" : "deposit";
  const availableAmount = enteredAmount(balance ?? "", "USDC");
  const input = withdrawAll ? balance ?? "" : amount;
  const value = enteredAmount(input, "USDC");
  const exceedsBalance = value !== null && (withdrawing || balance !== null)
    && (availableAmount === null || parseAmount(value, 6) > parseAmount(availableAmount, 6));
  const canReview = available && value !== null && !exceedsBalance && !busy;
  const shortcuts = !withdrawing && availableAmount !== null ? quickAmounts.filter(n => n <= Number(availableAmount)) : [];

  function updateAmount(next: string) {
    setAmount(next);
    setError(null);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!canReview || submitting.current) return;
    submitting.current = true;
    setBusy(true);
    setError(null);
    try {
      const result = await api.post<{ island?: IslandPayload }>("/intents", {
        kind: withdrawing ? "earn_withdraw" : "earn_deposit",
        params: { vault: "savings", amount: withdrawAll ? "all" : value },
      });
      if (result.island?.kind !== "confirm") throw new Error(`Couldn't prepare that ${action}. Please try again.`);
      push(result.island);
      onClose();
    } catch (e) {
      if (e instanceof ApiError && e.code === "VAULT_UNAVAILABLE") setError("Savings is unavailable right now.");
      else setError(e instanceof Error ? e.message : `Couldn't prepare that ${action}.`);
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }

  return (
    <Drawer open onOpenChange={(open) => { if (!open && !submitting.current) onClose(); }}>
      <DrawerContent title={withdrawing ? "Withdraw from savings" : "Deposit to savings"} showClose={!busy}>
        <form onSubmit={submit} className="flex flex-col gap-4">
          <div className="rounded-2xl border border-line bg-bg/50 px-4 py-3 focus-within:border-[#b4a7c6]">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
              <label htmlFor={amountId} className="text-sm text-muted">{withdrawing ? "Withdrawal amount" : "Deposit amount"}</label>
              {!withdrawing && balance !== null && <span className="text-xs text-muted">Available in wallet {savingsDollars(balance)}</span>}
            </div>
            <div className="flex items-center gap-1 py-1 text-4xl font-medium tabular-nums">
              <span aria-hidden="true" className="text-[#b4a7c6]">$</span>
              <input id={amountId} className="min-h-11 min-w-0 flex-1 bg-transparent tracking-tight outline-none placeholder:text-white/20"
                inputMode="decimal" placeholder="0.00" value={input} readOnly={withdrawAll} disabled={busy}
                aria-invalid={exceedsBalance || undefined} aria-describedby={exceedsBalance ? `${amountId}-error` : undefined}
                onChange={(e) => updateAmount(e.target.value)} />
            </div>
            {shortcuts.length > 0 && <div role="group" aria-label="Quick deposit amounts" className="mt-1 flex flex-wrap gap-2">
              {shortcuts.map(n => <button key={n} type="button" disabled={busy} aria-pressed={value !== null && Number(value) === n}
                onClick={() => updateAmount(String(n))}
                className="min-h-11 flex-1 rounded-xl border border-line bg-white/[0.035] px-2 text-sm font-medium text-[#ddd3ee] hover:bg-white/8 aria-pressed:border-[#b4a7c6] aria-pressed:bg-[#342b45]">
                ${n}
              </button>)}
            </div>}
          </div>
          {withdrawing && (
            <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <span className="text-muted">Available {savingsDollars(balance)}</span>
              <button type="button" aria-pressed={withdrawAll} disabled={busy || !availableAmount}
                onClick={() => { setWithdrawAll(!withdrawAll); setError(null); }}
                className="min-h-11 rounded-full border border-line px-3.5 font-medium text-[#d9cbe9] aria-pressed:bg-[#332d3f]">
                Withdraw all
              </button>
            </div>
          )}
          {!available && <p role="alert" className="text-sm text-danger">Savings is unavailable right now.</p>}
          {exceedsBalance && <p id={`${amountId}-error`} className="text-sm text-danger">
            This amount exceeds your {withdrawing ? "savings" : "wallet"} balance.
          </p>}
          {!withdrawing && available && <SavingsProjection amount={value} annualRate={annualRate} />}
          {error && <p role="alert" className="text-sm text-danger">{error}</p>}
          <Button type="submit" size="lg" variant="light" disabled={!canReview} aria-busy={busy}>
            {busy && <IconLoader2 className="size-5 motion-safe:animate-spin" aria-hidden="true" />}
            {busy ? "Preparing…" : `Review ${action}`}
          </Button>
        </form>
      </DrawerContent>
    </Drawer>
  );
}
