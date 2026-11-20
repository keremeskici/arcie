import { describe, expect, it } from "vitest";
import { loadEnv } from "./env.js";

const FULL = {
  CIRCLE_API_KEY: "TEST_API_KEY:a:b",
  CIRCLE_ENTITY_SECRET: "e".repeat(64),
  ONRAMP_API_KEY: "TEST_API_KEY:c:d",
  OPENAI_API_KEY: "sk-test",
  OPENAI_MODEL: "gpt-5.4-mini",
  DATABASE_URL: "postgres://localhost/arcie",
};

describe("loadEnv", () => {
  it("names every missing required key", () => {
    expect(() => loadEnv({})).toThrow(/CIRCLE_API_KEY.*CIRCLE_ENTITY_SECRET.*ONRAMP_API_KEY.*OPENAI_API_KEY.*OPENAI_MODEL.*DATABASE_URL/s);
  });

  it("applies defaults for optional keys", () => {
    expect(loadEnv(FULL)).toMatchObject({ PORT: 8787, DATABASE_URL: "postgres://localhost/arcie", DATABASE_POOL_MAX: 3, DATABASE_SSL: "disable", DEMO_USER_ID: "demo", CONFIRM_CHANNELS: "any" });
  });

  it("requires a valid Postgres URL and a positive integral pool size", () => {
    for (const DATABASE_URL of [undefined, "./arcie.db", "https://example.com/arcie", "postgres:///arcie"]) {
      expect(() => loadEnv({ ...FULL, DATABASE_URL })).toThrow(/DATABASE_URL/);
    }
    for (const DATABASE_POOL_MAX of ["-1", "0", "1.5"]) {
      expect(() => loadEnv({ ...FULL, DATABASE_POOL_MAX })).toThrow(/DATABASE_POOL_MAX/);
    }
    expect(loadEnv({ ...FULL, DATABASE_POOL_MAX: "2" }).DATABASE_POOL_MAX).toBe(2);
  });

  it("defaults non-loopback databases to required TLS", () => {
    const DATABASE_URL = "postgres://remote.example.invalid:6543/arcie";
    expect(loadEnv({ ...FULL, DATABASE_URL }).DATABASE_SSL).toBe("require");
    expect(loadEnv({ ...FULL, DATABASE_URL, DATABASE_SSL: "disable" }).DATABASE_SSL).toBe("disable");
    expect(() => loadEnv({ ...FULL, DATABASE_URL, DATABASE_SSL: "prefer" })).toThrow(/DATABASE_SSL/);
  });

  it("requires Privy keys and a wallet set in privy mode", () => {
    expect(() => loadEnv({ ...FULL, AUTH_MODE: "privy" })).toThrow(/PRIVY_APP_ID.*PRIVY_APP_SECRET.*CIRCLE_WALLET_SET_ID/s);
    expect(loadEnv({ ...FULL, AUTH_MODE: "privy", PRIVY_APP_ID: "a", PRIVY_APP_SECRET: "b", CIRCLE_WALLET_SET_ID: "c" }).AUTH_MODE).toBe("privy");
  });

  it("treats empty optional values as unset", () => {
    expect(loadEnv({ ...FULL, OPENAI_REASONING_EFFORT: "", ARC_RPC_URL: "" })).not.toHaveProperty("ARC_RPC_URL", "");
  });

  it("loads optional ELEVENLABS_AGENT_ID", () => {
    expect(loadEnv({ ...FULL, ELEVENLABS_AGENT_ID: "agent_123" }).ELEVENLABS_AGENT_ID).toBe("agent_123");
  });

  it("defaults onramp to sandbox and rejects an environment/key mismatch", () => {
    expect(loadEnv(FULL)).toHaveProperty("ONRAMP_ENVIRONMENT", "sandbox");
    expect(() => loadEnv({ ...FULL, ONRAMP_ENVIRONMENT: "production" })).toThrow(/ONRAMP_API_KEY/);
    expect(() => loadEnv({ ...FULL, ONRAMP_API_KEY: "LIVE_API_KEY:a:b" })).toThrow(/ONRAMP_API_KEY/);
  });
});
