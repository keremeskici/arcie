/** Thin client for the Arcie server. Every call carries the login token and the voice session id. */
export class ApiError extends Error {
  constructor(public code: string, message: string, public status: number) {
    super(message);
  }
}

type TokenGetter = () => Promise<string | null>;
let getToken: TokenGetter = async () => null;
let sessionId: string | null = null;

export function setTokenGetter(fn: TokenGetter) {
  getToken = fn;
}
export function setSessionId(id: string | null) {
  sessionId = id;
}

async function request<T>(method: "GET" | "POST" | "DELETE", path: string, body?: unknown, retried = false, signal?: AbortSignal, scope = sessionId): Promise<T> {
  const headers: Record<string, string> = {};
  const token = await getToken();
  if (token) headers.authorization = `Bearer ${token}`;
  if (scope) headers["x-arcie-session"] = scope;
  if (body !== undefined) headers["content-type"] = "application/json";
  const res = await fetch(path, { method, headers, signal, body: body === undefined ? undefined : JSON.stringify(body) });
  const json = (await res.json().catch(() => ({}))) as { error?: { code?: string; message?: string } };
  if (res.status === 401 && !retried) return request(method, path, body, true, signal, scope); // token refreshed by getToken()
  if (!res.ok) {
    throw new ApiError(json.error?.code ?? "UNKNOWN", json.error?.message ?? "Something went wrong.", res.status);
  }
  return json as T;
}

export const api = {
  get: <T>(path: string, signal?: AbortSignal, scope?: string | null) => request<T>("GET", path, undefined, false, signal, scope),
  post: <T>(path: string, body: unknown = {}, scope?: string | null, signal?: AbortSignal) => request<T>("POST", path, body, false, signal, scope),
  delete: <T>(path: string, scope?: string | null) => request<T>("DELETE", path, undefined, false, undefined, scope),
};

export type ServerConfig = {
  authMode: "dev" | "privy";
  demoUserId: string;
  demoWalletEnabled: boolean;
  privyAppId: string | null;
  elevenLabsAgentId: string | null;
};

export type Balances = {
  /** usdPrice: price of one unit, when the server has one (BTC via CoinGecko). */
  chains: { chain: string; tokens: { token: string; amount: string; usd: number | null; usdPrice?: number | null }[] }[];
  totalUsd: number | null;
  knownSubtotalUsd: number;
};

export type AuthSession = {
  user: { id: string; displayName: string | null; email: string | null };
  wallet: { address: string; chain: string };
};

export type Contact = { id: string; name: string; address: string; chain: string };

export type SavingsAccount = { available: boolean; annualRate: number | null; balance: string | null; earned: string | null };
