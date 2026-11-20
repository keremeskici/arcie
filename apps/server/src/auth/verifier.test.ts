import { describe, expect, it } from "vitest";
import { AuthError } from "./errors.js";
import { createPrivyVerifier, identityFromUser } from "./verifier.js";

describe("identityFromUser", () => {
  it("uses the Google name and email", () => {
    expect(
      identityFromUser({
        id: "did:privy:abc",
        linked_accounts: [{ type: "google_oauth", name: "Kerem Y", email: "kerem@example.com", subject: "1" }],
      }),
    ).toEqual({ userId: "did:privy:abc", displayName: "Kerem Y", email: "kerem@example.com" });
  });

  it("falls back to the email name for Apple or email logins", () => {
    expect(identityFromUser({ id: "u", linked_accounts: [{ type: "apple_oauth", email: "jane.doe@icloud.com", subject: "s" }] })).toEqual({
      userId: "u",
      displayName: "Jane.doe",
      email: "jane.doe@icloud.com",
    });
    expect(identityFromUser({ id: "u", linked_accounts: [{ type: "email", address: "sam@x.io" }] })).toMatchObject({ displayName: "Sam" });
  });

  it("records an external wallet as linkedWallet and names the user after it", () => {
    expect(
      identityFromUser({
        id: "u",
        linked_accounts: [{ type: "wallet", chain_type: "ethereum", address: "0xbf879877e05430ac14fcef6fe102df29e264b114", wallet_client_type: "metamask" }],
      }),
    ).toEqual({ userId: "u", displayName: "Wallet 0xBf87…b114", linkedWallet: "0xBf879877e05430aC14fcEF6fE102DF29e264b114" });
  });

  it("ignores Privy embedded wallets", () => {
    expect(
      identityFromUser({ id: "u", linked_accounts: [{ type: "wallet", chain_type: "ethereum", address: "0xbf879877e05430ac14fcef6fe102df29e264b114", wallet_client_type: "privy" }] }),
    ).toEqual({ userId: "u", displayName: "Arcie user" });
  });
});

describe("createPrivyVerifier", () => {
  it("rejects a malformed token as UNAUTHENTICATED", async () => {
    const v = createPrivyVerifier({ appId: "app", appSecret: "secret" });
    const err = await v.verify("garbage").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AuthError);
    expect((err as AuthError).code).toBe("UNAUTHENTICATED");
  });

  it("verifies through the client, loads the profile once, and caches it", async () => {
    let profileLoads = 0;
    const fakeClient = {
      utils: () => ({ auth: () => ({ verifyAccessToken: async (t: string) => ({ user_id: `did:${t}`, app_id: "app", session_id: "s", expiration: 0 }) }) }),
      users: () => ({ _get: async (id: string) => (profileLoads++, { id, linked_accounts: [{ type: "email", address: "ann@x.io" }] }) }),
    };
    const v = createPrivyVerifier({ appId: "app", appSecret: "secret" }, fakeClient);
    expect(await v.verify("t1")).toEqual({ userId: "did:t1", displayName: "Ann", email: "ann@x.io" });
    await v.verify("t1");
    expect(profileLoads).toBe(1);
  });

  it("still logs the user in when the profile lookup fails", async () => {
    const fakeClient = {
      utils: () => ({ auth: () => ({ verifyAccessToken: async () => ({ user_id: "did:x", app_id: "app", session_id: "s", expiration: 0 }) }) }),
      users: () => ({ _get: async () => Promise.reject(new Error("down")) }),
    };
    expect(await createPrivyVerifier({ appId: "a", appSecret: "b" }, fakeClient).verify("t")).toEqual({ userId: "did:x", displayName: "Arcie user" });
  });
});
