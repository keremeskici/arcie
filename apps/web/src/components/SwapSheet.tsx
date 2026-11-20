import type { IslandPayload, TokenSymbol } from "@arcie/core";
import { IconArrowsExchange, IconLoader2 } from "@tabler/icons-react";
import * as React from "react";
import { Button } from "@/components/Button";
import { Drawer, DrawerContent } from "@/components/ui/drawer";
import { api, ApiError } from "@/lib/api";
import { useIslands } from "@/lib/islands";
import { enteredAmount, TokenIcon, tokenLabel, walletCurrencies } from "@/lib/tokens";
import { useVoiceAccess } from "@/lib/voice-access";

type Pair = { tokenIn: TokenSymbol; tokenOut: TokenSymbol; amountIn: string };
type SwapRequest = Pair & { minOut: string; requestId: string };
type Quote = { estimatedOut: string; minOut: string; fees: { label: string; amount: string | null; token: string | null }[] };
type Result = { status: string; summary?: string; island?: IslandPayload | null; statusReason?: string | null };
type Phase = "idle" | "submitting" | "pending" | "checking" | "retry" | "finished";

const QUOTE_PERIOD = 500;
const QUOTE_TIMEOUT = 10_000;
const QUOTE_LIFETIME = 30_000;

function subscribeVisibility(callback: () => void) {
  document.addEventListener("visibilitychange", callback);
  return () => document.removeEventListener("visibilitychange", callback);
}
const pageVisible = () => document.visibilityState !== "hidden";

function useLiveQuote(pair: Pair | null, enabled: boolean) {
  const [snapshot, setSnapshot] = React.useState<{ pair: Pair; quote: Quote | null; at: number; error?: string } | null>(null);
  React.useEffect(() => {
    setSnapshot(null);
    if (!enabled || !pair) return;
    let active = true;
    let inFlight: AbortController | null = null;
    let timeout: ReturnType<typeof setTimeout>;
    let expiresAt = 0;
    async function refresh(input: Pair) {
      if (expiresAt && Date.now() >= expiresAt) {
        expiresAt = 0;
        setSnapshot(null);
      }
      if (inFlight || !pageVisible()) return;
      const controller = new AbortController();
      const at = Date.now();
      inFlight = controller;
      timeout = setTimeout(() => {
        controller.abort();
        inFlight = null;
        setSnapshot({ pair: input, quote: null, at: 0, error: "The price is taking longer than usual. Updating…" });
      }, QUOTE_TIMEOUT);
      try {
        const { data } = await api.post<{ data: Quote }>("/quotes/swap", input, controller.signal);
        if (!active || controller.signal.aborted || Date.now() - at >= QUOTE_LIFETIME) return;
        if (!enteredAmount(data.minOut, input.tokenOut)) throw new Error("Try a larger amount to get a price.");
        expiresAt = at + QUOTE_LIFETIME;
        setSnapshot({ pair: input, quote: data, at });
      } catch (err) {
        if (active && !controller.signal.aborted) setSnapshot({ pair: input, quote: null, at: 0, error: err instanceof Error ? err.message : "Couldn't load the price." });
      } finally {
        if (inFlight === controller) { clearTimeout(timeout); inFlight = null; }
      }
    }
    void refresh(pair);
    const timer = setInterval(() => void refresh(pair), QUOTE_PERIOD);
    return () => { active = false; clearInterval(timer); clearTimeout(timeout); inFlight?.abort(); };
  }, [pair, enabled]);
  return enabled && snapshot?.pair === pair ? snapshot : null;
}

function CurrencySelect({ label, value, onChange, disabled }: {
  label: string; value: TokenSymbol; onChange: (value: TokenSymbol) => void; disabled: boolean;
}) {
  return (
    <span className="flex shrink-0 items-center gap-1 rounded-full border border-line bg-card-2 px-2.5">
      <TokenIcon symbol={value} size={22} />
      <select aria-label={label} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value as TokenSymbol)}
        className="h-11 rounded-full bg-transparent pr-1 text-sm font-medium">
        {walletCurrencies.map((symbol) => <option key={symbol} value={symbol}>{tokenLabel(symbol)}</option>)}
      </select>
    </span>
  );
}

export function SwapSheet({ onClose }: { onClose: () => void }) {
  const { push, receipt, refreshBalances } = useIslands();
  const visible = React.useSyncExternalStore(subscribeVisibility, pageVisible);
  const voice = useVoiceAccess();
  const [tokenIn, setTokenIn] = React.useState<TokenSymbol>("USDC");
  const [tokenOut, setTokenOut] = React.useState<TokenSymbol>("EURC");
  const [amount, setAmount] = React.useState("");
  const [revision, refreshPrice] = React.useReducer((v: number) => v + 1, 0);
  const amountIn = enteredAmount(amount, tokenIn);
  const pair = React.useMemo(() => amountIn ? { tokenIn, tokenOut, amountIn } : null, [tokenIn, tokenOut, amountIn, revision]);
  const [phase, setPhase] = React.useState<Phase>("idle");
  const [message, setMessage] = React.useState<string | null>(null);
  const [accepted, setAccepted] = React.useState<Quote | null>(null);
  const request = React.useRef<SwapRequest | null>(null);
  const posting = React.useRef(false);
  const editing = phase === "idle";
  const processing = phase === "submitting" || phase === "checking" || phase === "pending";
  const quote = useLiveQuote(pair, editing && visible && !voice?.visible && !receipt);
  const shown = editing ? quote?.quote : accepted;

  React.useEffect(() => () => { request.current = null; }, []);
  const reset = React.useCallback((reason: string) => {
    request.current = null;
    setAccepted(null);
    setMessage(reason);
    refreshPrice();
    setPhase("idle");
  }, []);

  const receive = React.useCallback((result: Result, id: string) => {
    if (request.current?.requestId !== id) return;
    if (result.island?.kind === "receipt" && result.island.intentId === id) {
      request.current = null;
      push(result.island);
      onClose();
    } else if (result.status === "succeeded" || result.status === "failed") {
      setPhase("finished");
      setMessage(result.summary ?? (result.status === "succeeded" ? "Your swap completed." : "Your swap failed."));
      refreshBalances();
    } else if (result.status === "requote" || result.statusReason === "price_changed") {
      reset("The price changed. Check the new amount before swapping.");
    } else if (["rejected", "expired", "cancelled", "superseded"].includes(result.status)) {
      reset(result.summary ?? "This swap did not go through. Check the current price.");
    } else {
      setPhase("pending");
      setMessage(result.summary ?? "Your swap is processing.");
    }
  }, [push, onClose, refreshBalances, reset]);

  // A receipt may arrive over the event stream before the HTTP response.
  React.useEffect(() => {
    if (receipt && receipt.intentId === request.current?.requestId) {
      request.current = null;
      onClose();
    }
  }, [receipt, onClose]);

  React.useEffect(() => {
    const id = request.current?.requestId;
    if (!id || (phase !== "checking" && phase !== "pending")) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    async function check(intentId: string) {
      try {
        const detail = await api.get<Result>(`/intents/${intentId}`);
        if (!active || request.current?.requestId !== intentId) return;
        if (detail.status !== "executing" && detail.status !== "awaiting_confirmation") {
          receive(detail, intentId);
          return;
        }
        if (phase === "checking") {
          setPhase("pending");
          setMessage("Your swap is processing.");
          return;
        }
      } catch (err) {
        if (!active || request.current?.requestId !== intentId) return;
        if (phase === "checking" && err instanceof ApiError && err.status === 404) {
          setPhase("retry");
          setMessage("We couldn't find that swap. You can retry the same request.");
          return;
        }
        setMessage("Checking your swap. You can also check Activity.");
      }
      if (active) timer = setTimeout(() => void check(intentId), 2000);
    }
    if (phase === "checking") void check(id);
    else timer = setTimeout(() => void check(id), 2000);
    return () => { active = false; clearTimeout(timer); };
  }, [phase, receive]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (posting.current) return;
    let body = request.current;
    if (editing) {
      if (body || !pair || !quote?.quote) return;
      if (Date.now() - quote.at >= QUOTE_LIFETIME) { reset("Updating your price. Check the new amount before swapping."); return; }
      body = { ...pair, minOut: quote.quote.minOut, requestId: crypto.randomUUID() };
      request.current = body;
      setAccepted(quote.quote);
    } else if (phase !== "retry" || !body) return;
    const id = body.requestId;
    posting.current = true;
    setPhase("submitting");
    setMessage(null);
    try {
      receive(await api.post<Result>("/swaps", body), id);
    } catch (err) {
      if (request.current?.requestId !== id) return;
      if (err instanceof ApiError && err.status >= 400 && err.status < 500 && err.status !== 408) {
        reset(err.message);
      } else {
        setPhase("checking");
        setMessage("Checking whether your swap was received…");
      }
    } finally {
      posting.current = false;
    }
  }

  function changePair(nextIn: TokenSymbol, nextOut: TokenSymbol) {
    setTokenIn(nextIn);
    setTokenOut(nextOut);
    setMessage(null);
  }

  return (
    <Drawer open onOpenChange={(open) => { if (!open && phase !== "submitting") onClose(); }}>
      <DrawerContent title="Swap" showClose={phase !== "submitting"}>
        <form onSubmit={submit} className="flex w-full min-w-0 flex-col gap-4">
          <div className="relative grid min-w-0 grid-cols-1 gap-2">
            <div className="rounded-2xl border border-line bg-bg/60 px-4 py-3">
              <label htmlFor="swap-amount" className="text-sm text-muted">You pay</label>
              <div className="mt-1 flex items-center justify-between gap-2">
                <input id="swap-amount" aria-label="Swap amount" inputMode="decimal" placeholder="0" disabled={!editing} value={amount}
                  onChange={(e) => { setAmount(e.target.value); setMessage(null); }}
                  className="w-0 min-w-0 flex-1 rounded bg-transparent py-1 text-4xl font-medium tracking-tight tabular-nums placeholder:text-white/25" />
                <CurrencySelect label="Pay currency" value={tokenIn} disabled={!editing}
                  onChange={(next) => changePair(next, next === tokenOut ? tokenIn : tokenOut)} />
              </div>
            </div>
            <button type="button" aria-label="Reverse currencies" disabled={!editing} onClick={() => changePair(tokenOut, tokenIn)}
              className="absolute left-1/2 top-1/2 grid size-10 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border border-line bg-card text-muted hover:text-fg">
              <IconArrowsExchange size={19} className="rotate-90" aria-hidden="true" />
            </button>
            <div className="rounded-2xl border border-line bg-bg/60 px-4 py-3">
              <p className="text-sm text-muted">Estimated receive amount</p>
              <div className="mt-1 flex min-h-11 items-center justify-between gap-2">
                <output aria-label="Estimated receive amount" aria-live="off" className="min-w-0 flex-1 break-all text-3xl font-medium tracking-tight tabular-nums">
                  {shown ? <>{shown.estimatedOut}<span className="sr-only"> {tokenLabel(tokenOut)}</span></> : "—"}
                </output>
                <CurrencySelect label="Receive currency" value={tokenOut} disabled={!editing}
                  onChange={(next) => changePair(next === tokenIn ? tokenOut : tokenIn, next)} />
              </div>
            </div>
          </div>
          {shown && (
            <dl aria-label="Swap quote" className="space-y-1.5 px-1 text-sm">
              <QuoteRow label="At least" value={`${shown.minOut} ${tokenLabel(tokenOut)}`} />
              {shown.fees.map((fee, i) => <FeeRow key={i} fee={fee} />)}
            </dl>
          )}
          {(message || quote?.error) && <p role={processing || phase === "finished" ? "status" : "alert"} className="text-sm text-muted">{message || quote?.error}</p>}
          {phase === "finished" ? <Button size="lg" variant="light" onClick={onClose}>Done</Button> : (
            <Button size="lg" variant="light" type="submit" aria-busy={processing} disabled={phase !== "retry" && (!editing || !shown)}>
              {processing && <IconLoader2 className="size-5 motion-safe:animate-spin" aria-hidden="true" />}
              {phase === "retry" ? "Retry swap" : processing ? "Swapping…" : "Swap"}
            </Button>
          )}
          {(phase === "pending" || phase === "checking") && (
            <Button variant="ghost" onClick={onClose}>Check later in Activity</Button>
          )}
        </form>
      </DrawerContent>
    </Drawer>
  );
}

function QuoteRow({ label, value }: { label: string; value: string }) {
  return <div className="flex justify-between gap-4">
    <dt className="text-muted">{label}</dt><dd className="text-right font-medium tabular-nums">{value}</dd>
  </div>;
}

function FeeRow({ fee }: { fee: Quote["fees"][number] }) {
  if (fee.amount === null) return <QuoteRow label={fee.label} value="Unavailable" />;
  const amount = Number(fee.amount);
  const symbol = fee.token === "USDC" ? "$" : fee.token === "EURC" ? "€" : "";
  const suffix = !symbol && fee.token ? ` ${tokenLabel(fee.token)}` : "";
  const decimals = !symbol ? 8 : amount >= 1 ? 2 : amount >= 0.001 ? 3 : 4;
  const rounded = Number(amount.toFixed(decimals));
  const short = symbol && amount > 0 && amount < 0.0001
    ? `<${symbol}0.0001`
    : `${rounded !== amount ? "≈ " : ""}${symbol}${rounded.toLocaleString("en-US", { maximumFractionDigits: decimals })}${suffix}`;
  return <div className="flex items-baseline justify-between gap-4">
    <dt className="text-muted">{fee.label}</dt>
    <dd className="min-w-0 text-right tabular-nums"><details>
      <summary className="cursor-pointer rounded text-sm font-medium">{short}</summary>
      <p className="mt-1 break-all text-xs text-muted">{fee.amount}{fee.token && ` ${tokenLabel(fee.token)}`}</p>
    </details></dd>
  </div>;
}
