import { sessions, type DbOrTx } from "@arcie/db";
import { eq } from "drizzle-orm";
import type { Context } from "hono";
import { randomBytes } from "node:crypto";
import { AuthError } from "./errors.js";
import type { Identity, TokenVerifier } from "./verifier.js";

/** dev: x-arcie-user header or the demo user (tests, REPL, local demos). privy: Bearer Privy access token required. */
export type AuthMode = "dev" | "privy";

const VOICE_SESSION_TTL_MS = 2 * 3600_000;

export function createIdentify(deps: { mode: AuthMode; verifier?: TokenVerifier | undefined; demoUserId: string }) {
  return async (c: Context): Promise<Identity> => {
    if (deps.mode === "dev") {
      const userId = c.req.header("x-arcie-user") ?? deps.demoUserId;
      return { userId, displayName: userId };
    }
    const header = c.req.header("authorization") ?? "";
    const token = /^Bearer\s+(.+)$/i.exec(header)?.[1];
    if (!token || !deps.verifier) throw new AuthError("Please sign in.");
    return deps.verifier.verify(token);
  };
}

/** Unguessable id bound to one user, handed to ElevenLabs as the custom-LLM session_id (spec §17). */
export async function mintVoiceSession(db: DbOrTx, userId: string, now = new Date()): Promise<{ sessionId: string; expiresAt: string }> {
  const sessionId = randomBytes(32).toString("base64url");
  const expiresAt = new Date(now.getTime() + VOICE_SESSION_TTL_MS).toISOString();
  await db.insert(sessions).values({ id: sessionId, userId, channel: "voice", userTurn: 0, expiresAt });
  return { sessionId, expiresAt };
}

/** The user behind a minted voice session, or null if unknown, never minted, or expired. */
export async function resolveVoiceSession(db: DbOrTx, sessionId: string | undefined, now = new Date()): Promise<{ userId: string } | null> {
  if (!sessionId) return null;
  const [row] = await db.select().from(sessions).where(eq(sessions.id, sessionId)).limit(1);
  if (!row?.expiresAt || row.expiresAt <= now.toISOString()) return null;
  return { userId: row.userId };
}
