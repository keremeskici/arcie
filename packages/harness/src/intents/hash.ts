import { createHash } from "node:crypto";

function canonical(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canonical);
  if (v && typeof v === "object") {
    return Object.fromEntries(
      Object.keys(v as Record<string, unknown>)
        .sort()
        .map((k) => [k, canonical((v as Record<string, unknown>)[k])]),
    );
  }
  return v;
}

/** sha256 of key-sorted JSON: confirm must execute exactly what was previewed. */
export function paramsHash(params: object): string {
  return createHash("sha256").update(JSON.stringify(canonical(params))).digest("hex");
}
