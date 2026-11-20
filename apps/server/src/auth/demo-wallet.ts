import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const SESSION_MS = 2 * 3600_000;
const TOKEN = /^demo\.(\d+)\.([\w-]{22})\.([\w-]{43})$/;

export function createDemoWalletAuth(secret: string, userId: string) {
  const sign = (payload: string) => createHmac("sha256", secret)
    .update(JSON.stringify(["arcie-demo-wallet", userId, payload]))
    .digest("base64url");

  return {
    issue(now = Date.now()) {
      const expires = now + SESSION_MS;
      const payload = `${expires}.${randomBytes(16).toString("base64url")}`;
      return { token: `demo.${payload}.${sign(payload)}`, expiresAt: new Date(expires).toISOString() };
    },
    verify(token: string, now = Date.now()): number | null {
      const match = TOKEN.exec(token);
      if (!match) return null;
      const [, expires, nonce, signature] = match;
      const expiresAt = Number(expires);
      if (!Number.isSafeInteger(expiresAt) || expiresAt <= now) return null;
      if (!timingSafeEqual(Buffer.from(signature!), Buffer.from(sign(`${expires}.${nonce}`)))) return null;
      return expiresAt;
    },
  };
}
