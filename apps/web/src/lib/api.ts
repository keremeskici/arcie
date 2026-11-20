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

async function request<T>(method: "GET" | "POST", path: string, body?: unknown, retried = false): Promise<T> {
  const headers: Record<string, string> = {};
  const token = await getToken();
  if (token) headers.authorization = `Bearer ${token}`;
  if (sessionId) headers["x-arcie-session"] = sessionId;
  if (body !== undefined) headers["content-type"] = "application/json";
  const res = await fetch(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const json = (await res.json().catch(() => ({}))) as { error?: { code?: string; message?: string } };
  if (res.status === 401 && !retried) return request(method, path, body, true); // token refreshed by getToken()
  if (!res.ok || json.error) {
    throw new ApiError(json.error?.code ?? "UNKNOWN", json.error?.message ?? "Something went wrong.", res.status);
  }
  return json as T;
}

export const api = {
  get: <T>(path: string) => request<T>("GET", path),
  post: <T>(path: string, body: unknown = {}) => request<T>("POST", path, body),
};

export type ServerConfig = {
  authMode: "dev" | "privy";
  demoUserId: string;
  privyAppId: string | null;
  elevenLabsAgentId: string | null;
};

export type Balances = {
  chains: { chain: string; tokens: { token: string; amount: string; usd: number | null }[] }[];
  totalUsd: number | null;
  knownSubtotalUsd: number;
};

export type AuthSession = {
  user: { id: string; displayName: string | null; email: string | null };
  wallet: { address: string; chain: string };
};

export type Contact = { id: string; name: string; address: string; chain: string };
