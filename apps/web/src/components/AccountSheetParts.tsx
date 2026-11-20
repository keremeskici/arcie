import type { ActionKind } from "@arcie/core";
import * as React from "react";
import { api } from "@/lib/api";
import { Button } from "./Button";

export type SheetProps = { onClose: () => void };

export const actionLabels: Record<ActionKind, string> = {
  send: "Send", swap: "Swap", earn_deposit: "Savings deposit", earn_withdraw: "Savings withdrawal",
};

export function useSheetData<T>(path: string) {
  const [data, setData] = React.useState<T | null>(null);
  const [error, setError] = React.useState("");
  const [loading, setLoading] = React.useState(true);
  const [version, setVersion] = React.useState(0);
  const refresh = React.useCallback(() => setVersion((v) => v + 1), []);

  React.useEffect(() => {
    let current = true;
    setError("");
    setLoading(true);
    api.get<T>(path)
      .then((result) => { if (current) setData(result); })
      .catch((e: unknown) => { if (current) setError(e instanceof Error ? e.message : "Couldn’t load these details."); })
      .finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [path, version]);

  return { data, setData, error, loading, refresh };
}

export function SheetFeedback({ resource, label }: {
  resource: { data: unknown; error: string; loading: boolean; refresh: () => void };
  label: string;
}) {
  if (resource.error) return (
    <div className="flex flex-col gap-2">
      <p role="alert" className="text-sm text-danger">{resource.error}</p>
      <Button variant="ghost" onClick={resource.refresh}>Retry {label}</Button>
    </div>
  );
  if (resource.loading && !resource.data) return <p role="status" className="py-3 text-sm text-muted">Loading {label}…</p>;
  return null;
}

export function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="flex justify-between gap-4 py-2.5 text-sm">
    <dt className="max-w-[60%] shrink-0 text-muted">{label}</dt>
    <dd className="min-w-0 text-right font-medium [overflow-wrap:anywhere]">{children}</dd>
  </div>;
}
