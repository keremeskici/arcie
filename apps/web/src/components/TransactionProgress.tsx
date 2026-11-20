import type { ActionKind, ConfirmIsland } from "@arcie/core";
import { IconArrowUpRight, IconCheck } from "@tabler/icons-react";
import { TokenIcon } from "@/lib/tokens";

const LEGACY_ACTIONS: Partial<Record<string, ActionKind>> = {
  Send: "send", Swap: "swap", Invest: "earn_deposit", Withdraw: "earn_withdraw",
};

const PROGRESS_LABELS: Record<ActionKind, string> = {
  send: "Sending on Arc…", swap: "Swapping on Arc…",
  earn_deposit: "Depositing to savings…", earn_withdraw: "Withdrawing from savings…",
};

export function TransactionProgress({ island }: { island: ConfirmIsland }) {
  const amount = island.rows.find((row) => row.label === "Amount")?.value;
  const recipient = island.rows.find((row) => row.label === "To")?.value;
  const token = island.chips.includes("EUR") ? "EURC" : island.chips.includes("BTC") ? "cirBTC" : "USDC";
  // Saved reviews from earlier versions identified the action in their first chip.
  const action = island.action ?? LEGACY_ACTIONS[island.chips[0] ?? ""];
  const label = action ? PROGRESS_LABELS[action] : "Processing your transaction…";

  return (
    <div role="status" aria-live="polite" className="transaction-progress flex flex-col items-center pb-8 pt-4 text-center">
      <div aria-hidden="true" className="relative mb-6 grid size-40 place-items-center">
        <span className="transfer-halo absolute inset-2 rounded-full border border-accent/20 bg-accent/5" />
        <span className="transfer-halo transfer-halo-delayed absolute inset-2 rounded-full border border-accent/20" />
        <span className="absolute inset-5 rounded-full bg-accent/15 blur-2xl" />
        <span className="transfer-orbit absolute inset-3 rounded-full border border-transparent border-r-accent/60 border-t-accent/20" />
        <span className="transfer-token relative grid size-20 place-items-center rounded-full border border-white/10 bg-card-2 shadow-xl shadow-black/20">
          <TokenIcon symbol={token} size={56} />
          <span className="absolute -right-1 -top-1 grid size-7 place-items-center rounded-full border-4 border-card bg-accent text-white">
            <IconArrowUpRight className="size-4" stroke={2.5} />
          </span>
        </span>
      </div>
      <p className="text-lg font-medium">{label}</p>
      {amount ? <p className="mt-2 text-3xl font-semibold tracking-tight tabular-nums">{amount}</p> : null}
      {recipient ? <p className="mt-2 max-w-full break-all text-sm text-muted">To {recipient}</p> : null}
      <div aria-hidden="true" className="mt-5 flex gap-1.5">
        <span className="transfer-dot size-1.5 rounded-full bg-accent" />
        <span className="transfer-dot size-1.5 rounded-full bg-accent [animation-delay:160ms]" />
        <span className="transfer-dot size-1.5 rounded-full bg-accent [animation-delay:320ms]" />
      </div>
      <p className="mt-3 text-sm text-muted">Waiting for network confirmation.</p>
    </div>
  );
}

export function TransactionSuccess() {
  return (
    <div aria-hidden="true" className="transaction-success relative mb-2 grid size-24 place-items-center">
      <span className="success-ring absolute inset-0 rounded-full border border-success/30" />
      <span className="success-check grid size-16 place-items-center rounded-full bg-success/15 text-success">
        <IconCheck className="size-9" stroke={2.5} />
      </span>
    </div>
  );
}
