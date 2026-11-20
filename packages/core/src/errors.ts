export type ErrorCode =
  | "INSUFFICIENT_BALANCE"
  | "SLIPPAGE_EXCEEDED"
  | "QUOTE_EXPIRED"
  | "VAULT_UNAVAILABLE"
  | "POLICY_DENIED"
  | "INVALID_RECIPIENT"
  | "INVALID_AMOUNT"
  | "NOT_FOUND"
  | "RPC_UNAVAILABLE"
  | "CIRCLE_API_ERROR"
  | "ONRAMP_ERROR"
  | "UNKNOWN";

/** Templates use {var}; vars missing at render time fall back to the generic wording. */
const MESSAGES: Record<ErrorCode, { withVars?: string; plain: string }> = {
  INSUFFICIENT_BALANCE: {
    withVars: "You have {have} {token}, so I can't move {want}.",
    plain: "You don't have enough balance for that.",
  },
  SLIPPAGE_EXCEEDED: { plain: "The price moved too much, so nothing was swapped. Want a fresh quote?" },
  QUOTE_EXPIRED: { plain: "That quote expired. Want me to get a fresh one?" },
  VAULT_UNAVAILABLE: { plain: "That earning vault isn't available right now." },
  POLICY_DENIED: { plain: "That's outside the limits you've set, so I can't do it." },
  INVALID_RECIPIENT: { plain: "I couldn't find who to send that to." },
  INVALID_AMOUNT: { plain: "I didn't catch the amount. Say it as a number, like 5 or 5.50." },
  NOT_FOUND: { plain: "I couldn't find that request. Want to start again?" },
  RPC_UNAVAILABLE: { plain: "The network is busy right now. Let's try again in a moment." },
  CIRCLE_API_ERROR: { plain: "My payment provider had a problem. Nothing was moved." },
  ONRAMP_ERROR: { plain: "I couldn't open the add-money screen. Let's try again." },
  UNKNOWN: { plain: "Something went wrong on my side. Nothing was moved." },
};

export function spokenMessage(code: ErrorCode, vars?: Record<string, string>): string {
  const entry = MESSAGES[code];
  if (entry.withVars && vars) {
    const filled = entry.withVars.replace(/\{(\w+)\}/g, (match, key: string) => vars[key] ?? match);
    if (!/\{\w+\}/.test(filled)) return filled;
  }
  return entry.plain;
}

export class ArcieError extends Error {
  readonly code: ErrorCode;
  readonly spoken: string;
  readonly detail?: unknown;

  constructor(
    code: ErrorCode,
    opts: { spoken?: string; vars?: Record<string, string>; detail?: unknown; message?: string } = {},
  ) {
    const spoken = opts.spoken ?? spokenMessage(code, opts.vars);
    super(opts.message ?? `${code}: ${spoken}`);
    this.name = "ArcieError";
    this.code = code;
    this.spoken = spoken;
    if (opts.detail !== undefined) this.detail = opts.detail;
  }
}
