import type { Channel } from "@arcie/core";
import { sessions, type DbOrTx } from "@arcie/db";
import { and, eq, lt, sql } from "drizzle-orm";
import type { Context } from "hono";
import { randomBytes } from "node:crypto";
import type { createDemoWalletAuth } from "./demo-wallet.js";
import { AuthError } from "./errors.js";
import type { Identity, TokenVerifier } from "./verifier.js";

/** Local development can select a user by header. Hosted requests require a bearer token. */
export type AuthMode = "dev" | "privy";

const VOICE_SESSION_TTL_MS = 2 * 3600_000;

export function createIdentify(deps: {
  mode: AuthMode;
  verifier?: TokenVerifier | undefined;
  demoUserId: string;
  demoWalletAuth?: ReturnType<typeof createDemoWalletAuth> | undefined;
}) {
  return async (c: Context): Promise<Identity> => {
    if (deps.mode === "dev") {
      const userId = c.req.header("x-arcie-user") ?? deps.demoUserId;
      return { userId, displayName: userId };
    }
    const header = c.req.header("authorization") ?? "";
    const token = /^Bearer\s+(.+)$/i.exec(header)?.[1];
    if (token?.startsWith("demo.")) {
      const expiresAt = deps.demoWalletAuth?.verify(token);
      if (!expiresAt) throw new AuthError("Your demo session expired. Open the demo wallet again.");
      return { userId: deps.demoUserId, displayName: "Demo", demoWallet: { expiresAt } };
    }
    if (!token || !deps.verifier) throw new AuthError("Please sign in.");
    return deps.verifier.verify(token);
  };
}

/** Unguessable id bound to one user, handed to ElevenLabs as the custom-LLM session_id (spec §17). */
export async function mintVoiceSession(db: DbOrTx, userId: string, expiresBy = Infinity): Promise<{ sessionId: string; expiresAt: string }> {
  const sessionId = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Math.min(Date.now() + VOICE_SESSION_TTL_MS, expiresBy)).toISOString();
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

/** One model invocation owns each strictly newer message count. Retries keep their original count. */
export async function admitTurn(db: DbOrTx, sessionId: string, userId: string, channel: Channel, incoming: number): Promise<boolean> {
  if (incoming < 1) return false;
  const rows = await db.insert(sessions).values({ id: sessionId, userId, channel, userTurn: incoming })
    .onConflictDoUpdate({
      target: sessions.id,
      set: { userTurn: incoming },
      setWhere: and(eq(sessions.userId, userId), lt(sessions.userTurn, incoming),
        sql`(${sessions.expiresAt} is null or ${sessions.expiresAt}::timestamptz > clock_timestamp())`),
    }).returning({ turn: sessions.userTurn });
  return rows.length === 1;
}
