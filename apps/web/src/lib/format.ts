export const usd = (n: number | null | undefined) =>
  n === null || n === undefined
    ? "—"
    : n.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const tokenAmount = (amount: string) => {
  const n = Number(amount);
  if (!Number.isFinite(n)) return amount;
  return n.toLocaleString("en-US", { maximumFractionDigits: n < 1 ? 6 : 2 });
};

export const shortAddress = (a: string) => (a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a);

export const chainLabel = (c: string) => c.replace(/_/g, " ");

export const isAddress = (s: string) => /^0x[0-9a-fA-F]{40}$/.test(s.trim());

// The withdrawal form includes the full amount available, down to a fraction of a cent.
const savingsCurrency = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 6 });
export const savingsDollars = (amount: string | null) => amount === null ? "—" : savingsCurrency.format(amount as Intl.StringNumericLiteral);
