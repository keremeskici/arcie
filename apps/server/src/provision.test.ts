import { createDb, users, type Db } from "@arcie/db";
import { FakeAppKit } from "@arcie/appkit";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ db: null as unknown as Db, kit: null as unknown as FakeAppKit, creations: 0 }));
vi.mock("../scripts/lib.js", () => ({
  need: (name: string) => { const value = process.env[name]; if (!value) throw new Error(`${name} is missing`); return value; },
  openDb: () => state.db,
  appKit: () => state.kit,
  setEnv: () => { throw new Error("No environment writes allowed in this test"); },
  circleClient: () => ({
    createWallets: async () => {
      state.creations++;
      return { data: { wallets: [{ id: `w${state.creations}`, address: `0x${String(state.creations).padStart(40, "0")}` }] } };
    },
  }),
}));

beforeEach(() => {
  vi.resetModules();
  state.db = createDb(":memory:");
  state.kit = new FakeAppKit();
  state.creations = 0;
  vi.stubEnv("ADMIN_PRIVATE_KEY", "");
  vi.stubEnv("CIRCLE_WALLET_SET_ID", "test-wallet-set");
  vi.stubEnv("DEMO_USER_ID", "demo");
  vi.stubEnv("WALLET_ACCOUNT_TYPE", "EOA");
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe("optional operator funding (F17)", () => {
  it("provisions without an admin key when funding was not requested", async () => {
    vi.spyOn(process, "argv", "get").mockReturnValue(["node", "provision"]);
    await expect(import("../scripts/provision.js")).resolves.toBeDefined();
    expect(state.db.select().from(users).all()).toHaveLength(2);
    expect(state.creations).toBe(2);
  });
  it("fails before provisioning when funding is requested without an admin key", async () => {
    vi.spyOn(process, "argv", "get").mockReturnValue(["node", "provision", "--fund", "1"]);
    await expect(import("../scripts/provision.js")).rejects.toThrow("ADMIN_PRIVATE_KEY");
    expect(state.creations).toBe(0);
    expect(state.db.select().from(users).all()).toHaveLength(0);
  });
});
