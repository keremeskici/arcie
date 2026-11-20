/** Shared by testing.ts (workers) and vitest.global-setup.ts (main process); must not import vitest. */
export const TEMPLATE_DB = "arcie_template";

export function withDatabase(url: string, database: string): string {
  const u = new URL(url);
  u.pathname = `/${database}`;
  return u.toString();
}
