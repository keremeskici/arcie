import { describe, expect, it, vi } from "vitest";
import type { WalletRef } from "./port.js";

const sdk = vi.hoisted(() => ({ swap: vi.fn(), waitForSwap: vi.fn(), getPosition: vi.fn(), createSession: vi.fn(), createServer: vi.fn() }));
vi.mock("@circle-fin/app-kit", () => ({
  KitError: class extends Error {},
  AppKit: class {
    swap = sdk.swap;
    waitForSwap = sdk.waitForSwap;
    earn = { getPosition: sdk.getPosition };
  },
}));
vi.mock("@circle-fin/app-kit/server", () => ({ createAppServerKit: (config: unknown) => {
  sdk.createServer(config);
  return { onramp: { createSession: sdk.createSession } };
} }));
import { createCircleAppKit } from "./circle.js";

const w: WalletRef = { chain: "Arc_Testnet", address: "0x000000000000000000000000000000000000dEaD", circleWalletId: "w1" };

describe("Circle sandbox checkout", () => {
  it("does not invent a provider session ID when Circle omits it", async () => {
    sdk.createSession.mockResolvedValue({ sessionToken: "short-lived", widgetUrl: "https://onramp-sandbox.arc.io/?sessionToken=short-lived", expiresAt: "2027-01-01T00:00:00Z" });
    const kit = createCircleAppKit({ circleApiKey: "TEST_API_KEY:fixture:fixture", entitySecret: "e".repeat(64), onrampApiKey: "test" });
    const session = await kit.createOnrampSession({ appUserId: "demo", destinationAddress: w.address, token: "USDC" });
    expect(session).not.toHaveProperty("sessionId");
  });
  it("pairs sandbox origins and preserves the complete checkout session", async () => {
    const session = { sessionId: "checkout-1", sessionToken: "short-lived", widgetUrl: "https://onramp-sandbox.arc.io/?sessionToken=short-lived&tokens=USDC", expiresAt: "2027-01-01T00:00:00Z" };
    sdk.createSession.mockResolvedValue({ ...session, internalDebug: "must not reach the browser" });
    const kit = createCircleAppKit({ circleApiKey: "TEST_API_KEY:fixture:fixture", entitySecret: "e".repeat(64), onrampApiKey: "test" });
    expect(sdk.createServer).toHaveBeenLastCalledWith({ onramp: {
      apiKey: "test", baseUrl: "https://api-test.circle.com", widgetBaseUrl: "https://onramp-sandbox.arc.io",
    } });
    expect(await kit.createOnrampSession({ appUserId: "demo", destinationAddress: w.address, token: "USDC", amount: "20" })).toEqual({ ...session, environment: "sandbox" });
    expect(sdk.createSession).toHaveBeenLastCalledWith({ appUserId: "demo", destinationAddress: w.address, amount: "20", currency: "USD", assets: { tokens: ["USDC"] } });
  });
});

describe("Circle swap execution boundary", () => {
  it("passes the user's approved floor as the SDK stopLimit (F2)", async () => {
    sdk.swap.mockResolvedValue({ txHash: "0x123", progress: { status: "DONE" }, amountOut: "9.2" });
    const kit = createCircleAppKit({ circleApiKey: "TEST_API_KEY:fixture:fixture", entitySecret: "e".repeat(64), onrampApiKey: "test" });
    await kit.swap(w, { tokenIn: "USDC", tokenOut: "EURC", amountIn: "10", slippageBps: 100, minOut: "9.108" });
    expect(sdk.swap.mock.calls.at(-1)?.[0].config).toMatchObject({ stopLimit: "9.108" });
  });

  it("returns null from getPosition when the wallet/vault position is not registered in EarnKit", async () => {
    sdk.getPosition.mockRejectedValue(Object.assign(new Error("EARN_INVALID_INPUT: The requested wallet/vault position is not registered."), { code: 1104 }));
    const kit = createCircleAppKit({ circleApiKey: "TEST_API_KEY:fixture:fixture", entitySecret: "e".repeat(64), onrampApiKey: "test" });
    expect(await kit.getPosition(w, "0x8f2d33b5d4b9b5f02df635ae308f7b4c9da8d2dc")).toBeNull();
  });
});

it("keeps swap settlement unknown when Circle has no record of the submitted hash", async () => {
  const kit = createCircleAppKit({ circleApiKey: "TEST_API_KEY:fixture:fixture", entitySecret: "e".repeat(64), onrampApiKey: "test" });
  sdk.waitForSwap.mockResolvedValue({ progress: { status: "NOT_FOUND" } });
  expect((await kit.waitForSwap(w, "0x123", 10)).status).toBe("PENDING");
});
