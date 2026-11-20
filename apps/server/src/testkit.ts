/** Test-only wiring: a full app on FakeAppKit with a seeded demo user and wallet. */
import { FakeAppKit, type WalletCreator, type WalletRef } from "@arcie/appkit";
import { seed, wallets } from "@arcie/db";
import { createTestDb } from "@arcie/db/testing";
import { createHarness, DbPolicyProvider, EventLog } from "@arcie/harness";
import { createApp, type AppDeps } from "./create-app.js";
import { AuthError } from "./auth/errors.js";
import { createIdentify, type AuthMode } from "./auth/identify.js";
import { onboard } from "./auth/onboard.js";
import type { TokenVerifier } from "./auth/verifier.js";
import type { AgentFn } from "./llm/route.js";

export const DEMO_WALLET: WalletRef = { chain: "Arc_Testnet", address: "0x000000000000000000000000000000000000dEaD", circleWalletId: "w1" };

const silentAgent: AgentFn = async function* () {
  yield "";
};

/** "Bearer tok-<userId>" is valid for <userId>; anything else is rejected. */
export const fakeVerifier: TokenVerifier = {
  async verify(token) {
    if (!token.startsWith("tok-")) throw new AuthError("bad token");
    const userId = token.slice(4);
    return { userId, displayName: `User ${userId}` };
  },
};

function fakeCircle(): WalletCreator {
  const byKey = new Map<string, { id: string; address: string }>();
  return {
    async createWallets(input) {
      if (!byKey.has(input.idempotencyKey)) {
        const n = byKey.size + 1;
        byKey.set(input.idempotencyKey, { id: `cw-${n}`, address: `0x${n.toString(16).padStart(40, "a")}` });
      }
      return { data: { wallets: [byKey.get(input.idempotencyKey)!] } };
    },
  };
}

export async function testApp(over: Partial<AppDeps> & { authMode?: AuthMode } = {}) {
  // Pass `db` to build a second app instance on an existing test database (already seeded by the first).
  const created = over.db ? null : await createTestDb();
  const db = over.db ?? created!.db;
  const url = created?.url ?? "";
  const close = created?.close ?? (async () => {});
  if (created) {
    await seed(db, { userId: "demo" });
    await db.insert(wallets).values({ id: "w1", userId: "demo", chain: "Arc_Testnet", circleWalletId: "w1", address: DEMO_WALLET.address, accountType: "EOA" });
  }
  const kit = new FakeAppKit();
  kit.setBalance(DEMO_WALLET, "USDC", "100");
  kit.setBalance(DEMO_WALLET, "EURC", "20");
  const events = new EventLog(db);
  const harness = createHarness({ db, kit, policy: new DbPolicyProvider(db), events });
  const authMode = over.authMode ?? "dev";
  const circle = fakeCircle();
  const deps: AppDeps = {
    db,
    kit,
    events,
    harness,
    agent: silentAgent,
    demoUserId: "demo",
    model: "test",
    authMode,
    identify: createIdentify({ mode: authMode, verifier: fakeVerifier, demoUserId: "demo" }),
    onboard: (id) => onboard({ db, circle, walletSetId: "ws" }, id),
    ...over,
  };
  const app = createApp(deps);
  /** Responses typed loosely for assertions. */
  type TestResponse = Omit<Response, "json"> & { json(): Promise<any> };
  const call = async (method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<TestResponse> =>
    (await app.request(path, {
      method,
      headers: { "content-type": "application/json", ...headers },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })) as TestResponse;
  return { app, db, url, kit, events, harness, call, close };
}
