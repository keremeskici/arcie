import { PrivyClient } from "@privy-io/node";
import { getAddress } from "viem";
import { AuthError } from "./errors.js";

export interface Identity {
  /** Privy user id (DID); also the Arcie user id. */
  userId: string;
  displayName: string;
  email?: string;
  /** External wallet the user logged in with (identity only). */
  linkedWallet?: `0x${string}`;
}

export interface TokenVerifier {
  verify(token: string): Promise<Identity>;
}

/** The slice of PrivyClient we use (lets tests fake it). */
export interface PrivyLike {
  utils(): { auth(): { verifyAccessToken(token: string): Promise<{ user_id: string }> } };
  users(): { _get(userId: string): Promise<{ id: string; linked_accounts: unknown[] }> };
}

type Linked = { type?: string; name?: string | null; email?: string | null; address?: string; chain_type?: string; wallet_client_type?: string };

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

/** Picks a friendly name, email and external wallet from Privy's linked accounts. */
export function identityFromUser(u: { id: string; linked_accounts: unknown[] }): Identity {
  const accounts = u.linked_accounts as Linked[];
  const google = accounts.find((a) => a.type === "google_oauth");
  const email =
    google?.email ??
    accounts.find((a) => a.type === "apple_oauth" && a.email)?.email ??
    accounts.find((a) => a.type === "email")?.address ??
    undefined;
  const wallet = accounts.find((a) => a.type === "wallet" && a.chain_type === "ethereum" && a.wallet_client_type !== "privy" && a.address);
  const linkedWallet = wallet?.address ? getAddress(wallet.address) : undefined;

  const displayName =
    google?.name ?? (email ? capitalize(email.split("@")[0]!) : linkedWallet ? `Wallet ${short(linkedWallet)}` : "Arcie user");

  return { userId: u.id, displayName, ...(email ? { email } : {}), ...(linkedWallet ? { linkedWallet } : {}) };
}

/** Verifies Privy access tokens (spec §17). Profile lookups are cached per user and optional. */
export function createPrivyVerifier(cfg: { appId: string; appSecret: string; jwtVerificationKey?: string | undefined }, client?: PrivyLike): TokenVerifier {
  const privy: PrivyLike =
    client ??
    (new PrivyClient({ appId: cfg.appId, appSecret: cfg.appSecret, ...(cfg.jwtVerificationKey ? { jwtVerificationKey: cfg.jwtVerificationKey } : {}) }) as unknown as PrivyLike);
  const profiles = new Map<string, Identity>();

  return {
    async verify(token: string): Promise<Identity> {
      let userId: string;
      try {
        ({ user_id: userId } = await privy.utils().auth().verifyAccessToken(token));
      } catch {
        throw new AuthError("Your login expired or isn't valid. Please sign in again.");
      }
      const cached = profiles.get(userId);
      if (cached) return cached;
      try {
        const identity = identityFromUser(await privy.users()._get(userId));
        profiles.set(userId, identity);
        return identity;
      } catch {
        return { userId, displayName: "Arcie user" };
      }
    },
  };
}
