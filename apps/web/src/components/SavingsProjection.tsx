import { useState } from "react";
import { savingsDollars, usd } from "@/lib/format";

const periods = [1, 3, 5];
const percent = new Intl.NumberFormat("en-US", { style: "percent", maximumFractionDigits: 2 });

export function SavingsProjection({ amount, annualRate }: { amount: string | null; annualRate: number | null }) {
  const [years, setYears] = useState(1);
  const principal = Number(amount);
  const growthRate = annualRate === null ? NaN : Math.log1p(annualRate);
  const earnings = principal * Math.expm1(growthRate * years);
  const projected = principal + earnings;
  if (annualRate === null || !Number.isFinite(growthRate) || !Number.isFinite(projected)) {
    return <p className="text-sm text-muted">Growth estimate unavailable.</p>;
  }

  const period = `${years} ${years === 1 ? "year" : "years"}`;
  const projectedValue = projected < 0.01 ? savingsDollars(projected.toFixed(6)) : usd(projected);
  const smallEarnings = earnings !== 0 && Math.abs(earnings) < 0.01;
  const estimatedReturn = smallEarnings
    ? earnings > 0 ? "Less than 1¢ growth" : "Less than 1¢ decline"
    : `${earnings > 0 ? "+" : ""}${usd(earnings)}`;

  return (
    <figure aria-label="Savings growth projection"
      className="overflow-hidden rounded-2xl border border-[#bcacd7]/20 bg-linear-to-b from-[#262036] to-[#191621] p-4">
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
        <figcaption className="text-sm font-medium text-[#eee7fa]">Projected growth</figcaption>
        <p className="text-xs text-[#c9badf]">{percent.format(annualRate)} variable annual rate</p>
      </div>
      <div aria-live="polite" className="mt-3">
        {amount === null ? (
          <p className="text-sm text-[#c9badf]">Enter an amount to preview growth.</p>
        ) : (
          <>
            <p className="text-xs text-[#c9badf]">Estimated value in {period}</p>
            <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
              <p className="text-[30px] font-medium leading-tight tracking-tight tabular-nums">
                {projectedValue}
              </p>
              <p className="text-sm font-medium tabular-nums text-[#d2baff]">{estimatedReturn}</p>
            </div>
          </>
        )}
      </div>
      {amount !== null && <GrowthCurve key={`${amount}:${years}`} logGrowth={growthRate * years}
        startingValue={savingsDollars(amount)} endingValue={projectedValue} />}
      <div role="group" aria-label="Projection period" className="mt-3 flex rounded-xl bg-black/20 p-0.5">
        {periods.map(duration => <button type="button" key={duration} aria-pressed={years === duration}
          onClick={() => setYears(duration)}
          className="min-h-11 flex-1 rounded-[10px] px-2 text-sm font-medium text-[#c9badf] hover:text-white aria-pressed:bg-[#413454] aria-pressed:text-white">
          {duration} {duration === 1 ? "year" : "years"}
        </button>)}
      </div>
    </figure>
  );
}

function GrowthCurve({ logGrowth, startingValue, endingValue }: {
  logGrowth: number; startingValue: string; endingValue: string;
}) {
  const change = Math.expm1(logGrowth);
  const start = 50 + 35 * Math.sign(change);
  const end = 100 - start;
  const startRow = change === 0 ? 2 : change > 0 ? 3 : 1;
  const points = Array.from({ length: 25 }, (_, index) => {
    const x = index / 24;
    // This unscaled illustration gives the acceleration room to read even at small rates.
    const progress = change === 0 ? 0 : Math.expm1(logGrowth * x ** 2) / change;
    return { x: x * 100, y: start + (end - start) * progress };
  });
  const curve = points.map(({ x, y }) => `${x}% ${y}%`).join(", ");
  const lowerEdge = points.toReversed().map(({ x, y }) => `${x}% calc(${y}% + 2px)`).join(", ");

  return (
    <div className="mt-2 grid h-[84px] grid-cols-[fit-content(42%)_minmax(0,1fr)] gap-2 pr-1.5">
      <div className="grid min-w-0 grid-rows-[30%_40%_30%] items-center justify-items-end text-xs tabular-nums text-[#c9badf]">
        <span className="w-full truncate text-right" style={{ gridRow: startRow }} title={startingValue}>
          <span className="sr-only">{change === 0 ? "Starting and ending balance" : "Starting balance"}</span>
          {startingValue}
        </span>
        {change !== 0 && (
          <span className="w-full truncate text-right" style={{ gridRow: 4 - startRow }} title={endingValue}>
            <span className="sr-only">Projected ending balance</span>
            {endingValue}
          </span>
        )}
      </div>
      <div role="img" aria-label="Projected growth curve" className="relative">
        <div className="absolute inset-x-0 top-[15%] border-t border-dashed border-white/10" />
        <div className="absolute inset-x-0 top-1/2 border-t border-dashed border-white/10" />
        <div className="absolute inset-x-0 top-[85%] border-t border-dashed border-white/10" />
        <div className="absolute inset-0 motion-safe:animate-[savings-curve-spring_520ms_ease-out_both]"
          style={{ transformOrigin: `left ${start}%` }}>
          <div className="absolute inset-0 bg-linear-to-b from-[#ae87ed]/40 to-[#ae87ed]/0"
            style={{ clipPath: `polygon(${curve}, 100% 100%, 0 100%)` }} />
          <div className="absolute inset-0 bg-[#d2baff]" style={{ clipPath: `polygon(${curve}, ${lowerEdge})` }} />
          <span className="absolute right-0 size-2 -translate-y-1/2 translate-x-1/2 rounded-full bg-[#eee3ff] ring-4 ring-[#c7a5ff]/25"
            style={{ top: `${end}%` }} />
        </div>
      </div>
    </div>
  );
}
