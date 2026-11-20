import { ArcieError } from "@arcie/core";
import { KitError } from "@circle-fin/app-kit";

const SLIPPAGE_RE = /slippage|stop.?limit/i;
const INSUFFICIENT_RE = /insufficient/i;

/** Normalizes App Kit / Circle / RPC failures into ArcieError. Raw error stays in `detail` (audit only). */
export function mapKitError(e: unknown): ArcieError {
  if (e instanceof ArcieError) return e;

  const name = e instanceof KitError ? e.name : "";
  const message = e instanceof Error ? e.message : String(e);
  const text = `${name} ${message}`;

  if (name === "INPUT_INSUFFICIENT_SWAP_AMOUNT") {
    return new ArcieError("INVALID_AMOUNT", { spoken: "That amount is too small to swap.", detail: e });
  }
  if (SLIPPAGE_RE.test(text)) return new ArcieError("SLIPPAGE_EXCEEDED", { detail: e });

  if (e instanceof KitError) {
    switch (e.type) {
      case "BALANCE":
        return new ArcieError("INSUFFICIENT_BALANCE", { detail: e });
      case "LIQUIDITY":
        return new ArcieError("SLIPPAGE_EXCEEDED", {
          spoken: "There isn't enough liquidity for that size right now. Try a smaller amount.",
          detail: e,
        });
      case "RATE_LIMIT":
      case "NETWORK":
      case "RPC":
        return new ArcieError("RPC_UNAVAILABLE", { detail: e });
      case "SERVICE":
        return new ArcieError("CIRCLE_API_ERROR", { detail: e });
      case "INPUT":
        if (INSUFFICIENT_RE.test(text)) return new ArcieError("INSUFFICIENT_BALANCE", { detail: e });
        break;
    }
  } else if (INSUFFICIENT_RE.test(text)) {
    return new ArcieError("INSUFFICIENT_BALANCE", { detail: e });
  }

  return new ArcieError("UNKNOWN", { detail: e });
}
