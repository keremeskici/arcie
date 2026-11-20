import type { OnrampIsland } from "@arcie/core";
import { IconArrowRight, IconChevronDown, IconWallet } from "@tabler/icons-react";
import * as React from "react";
import { createOnrampController } from "../../../server/src/client/onramp";
import { Button } from "@/components/Button";
import { Drawer, DrawerContent } from "@/components/ui/drawer";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { shortAddress } from "@/lib/format";
import { useIslands } from "@/lib/islands";
import { enteredAmount, TokenIcon, tokenLabel } from "@/lib/tokens";

type Props = { open: boolean; onOpenChange: (open: boolean) => void; onVoiceOpen?: () => void };
const presets = [25, 50, 100, 250];

export function OnrampSheet({ open, onOpenChange, onVoiceOpen }: Props) {
  const { onramp, clear, refreshBalances } = useIslands();
  const [container, setContainer] = React.useState<HTMLDivElement | null>(null);
  const [details, setDetails] = React.useState<OnrampIsland | null>(null);
  const [status, setStatus] = React.useState("");
  const [canRetry, setCanRetry] = React.useState(false);
  const [token, setToken] = React.useState("USDC");
  const [amount, setAmount] = React.useState("");
  const amountId = React.useId();
  const currencyMark = token === "EURC" ? "€" : "$";
  const callbacks = React.useRef({ onOpenChange, onVoiceOpen });
  React.useLayoutEffect(() => { callbacks.current = { onOpenChange, onVoiceOpen }; }, [onOpenChange, onVoiceOpen]);

  // Keep one controller across sheet openings so a delayed REST response or SSE echo stays dismissed.
  const controller = React.useMemo(() => container && createOnrampController({
    view: {
      container,
      show: () => callbacks.current.onOpenChange(true),
      hide: () => {
        setStatus("");
        setDetails(null);
        setCanRetry(false);
        setAmount("");
        setToken("USDC");
      },
      status: setStatus,
      retry: setCanRetry,
      details: (island) => {
        setDetails(island);
        if (!island.requestId) callbacks.current.onVoiceOpen?.();
      },
    },
    mint: async (params) => {
      const result = await api.post<{ island?: OnrampIsland }>("/onramp/sessions", params);
      if (result.island?.kind !== "onramp") throw new Error("Couldn't prepare your checkout. Please try again.");
      return result.island;
    },
    record: async (type, payload) => { await api.post("/onramp/events", { type, payload }); },
    refresh: async () => refreshBalances(),
  }), [container, refreshBalances]);

  React.useEffect(() => () => controller?.destroy(), [controller]);

  const wasOpen = React.useRef(false);
  React.useLayoutEffect(() => {
    if (wasOpen.current && !open) controller?.close();
    wasOpen.current = open;
  }, [open, controller]);

  React.useEffect(() => {
    if (!controller || !onramp) return;
    void controller.open(onramp);
    clear("onramp");
  }, [controller, onramp, clear]);

  const spendAmount = enteredAmount(amount, token);
  const validAmount = amount === "" || spendAmount !== null;

  function start(event: React.FormEvent) {
    event.preventDefault();
    if (validAmount && !status) void controller?.start({ token, ...(spendAmount ? { amount: spendAmount } : {}) });
  }

  return (
    <Drawer open={open} onOpenChange={onOpenChange} voiceHandoff="onramp">
      <DrawerContent title="Add money" keepMounted>
        {status ? (
          <div className="flex flex-col gap-3">
            {details ? (
              <div className="overflow-hidden rounded-[20px] border border-line bg-bg/45">
                <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
                  <span className="inline-flex items-center gap-2 text-base font-semibold tabular-nums">
                    <TokenIcon symbol={details.token} size={24} />
                    <span>{details.amount ? details.amount + " " : ""}{tokenLabel(details.token)}</span>
                  </span>
                  <span className="rounded-full bg-[#302b3d] px-2.5 py-1 text-xs font-medium text-[#decff4]">
                    {details.environment === "sandbox" ? "Sandbox · No real money" : "Live checkout"}
                  </span>
                </div>
                <details className="group border-t border-line">
                  <summary className="flex min-h-11 cursor-pointer list-none flex-wrap items-center gap-2 px-4 py-2 text-xs focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent [&::-webkit-details-marker]:hidden">
                    <IconWallet size={15} className="text-muted" aria-hidden="true" />
                    <span className="text-muted">Destination wallet</span>
                    <span className="ml-auto font-mono">{shortAddress(details.destinationAddress)}</span>
                    <IconChevronDown size={14} className="text-muted group-open:rotate-180" aria-hidden="true" />
                  </summary>
                  <div className="px-4 pb-3">
                    <p className="select-all break-all font-mono text-xs">{details.destinationAddress}</p>
                    {details.environment === "sandbox" && <p className="mt-2 text-xs text-muted">Use test details. Arcie shows balances on Arc Testnet.</p>}
                  </div>
                </details>
              </div>
            ) : null}
            <p role="status" className="text-sm text-muted">{status}</p>
            {canRetry ? <Button variant="light" onClick={() => void controller?.retry()}>Restart checkout</Button> : null}
          </div>
        ) : (
          <form onSubmit={start} className="flex flex-col gap-4">
            <div className="rounded-[24px] border border-[#b8a9de]/15 bg-[radial-gradient(130%_160%_at_0_0,#2c2638_0%,#211e2b_50%,#1a1922_100%)] p-4 sm:p-5">
              <div className="flex items-center justify-between gap-3">
                <label htmlFor={amountId} className="text-sm font-medium text-[#c8c3d3]">Amount</label>
                <div className="relative inline-flex h-11 items-center gap-2 rounded-full border border-white/10 bg-black/20 px-2.5 text-sm font-semibold focus-within:ring-2 focus-within:ring-accent">
                  <TokenIcon symbol={token} size={21} />
                  <span aria-hidden="true">{tokenLabel(token)}</span>
                  <IconChevronDown size={14} className="text-muted" aria-hidden="true" />
                  <select aria-label="Currency" value={token} onChange={(e) => setToken(e.target.value)}
                    className="absolute inset-0 size-full cursor-pointer rounded-full opacity-0">
                    <option value="USDC">US dollar (USD)</option>
                    <option value="EURC">Euro (EUR)</option>
                  </select>
                </div>
              </div>
              <div className={cn("my-4 flex items-baseline gap-0.5 font-medium leading-none tracking-[-0.06em] tabular-nums",
                amount.length > 8 ? "text-[clamp(2rem,8vw,2.75rem)]" : "text-[clamp(3rem,14vw,4rem)]")}>
                <label htmlFor={amountId} aria-hidden="true" className="cursor-text text-[#b9aacd]">{currencyMark}</label>
                <input id={amountId} aria-label={`Amount to spend in ${tokenLabel(token)}`}
                  aria-description="You can also set the amount in checkout." inputMode="decimal" autoComplete="off"
                  placeholder="0" value={amount} onChange={(e) => setAmount(e.target.value.trim().replace(",", "."))}
                  aria-invalid={!validAmount} aria-describedby={validAmount ? undefined : `${amountId}-error`}
                  className="min-w-0 flex-1 rounded-md bg-transparent py-1 caret-[#cab7f7] outline-none placeholder:text-[#c5c0ce] focus-visible:ring-2 focus-visible:ring-[#b9a9d6]/65" />
              </div>
              <div role="group" aria-label="Preset amounts" className="grid grid-cols-4 gap-1.5">
                {presets.map(value => (
                  <button key={value} type="button" aria-pressed={spendAmount !== null && Number(spendAmount) === value}
                    onClick={() => setAmount(String(value))}
                    className="min-h-11 rounded-full border border-white/8 bg-white/5 px-1 text-sm font-medium tabular-nums hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-accent aria-pressed:border-[#a48abf] aria-pressed:bg-[#44364f] aria-pressed:text-[#f5ebff]">
                    {currencyMark}{value}
                  </button>
                ))}
              </div>
            </div>
            {!validAmount && <p id={`${amountId}-error`} role="alert" className="text-sm text-danger">Enter a positive amount with up to six decimal places.</p>}
            <Button type="submit" size="lg" variant="light" disabled={!validAmount || !controller}>
              Open checkout <IconArrowRight size={18} aria-hidden="true" />
            </Button>
          </form>
        )}
        <div ref={setContainer} className="mt-3 h-[min(65dvh,720px)] min-h-80 w-full overflow-hidden rounded-xl empty:hidden" />
      </DrawerContent>
    </Drawer>
  );
}
