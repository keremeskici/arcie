import { expect, it, vi } from "vitest";
const provider = vi.hoisted(() => ({ writeContract: vi.fn(), waitForTransactionReceipt: vi.fn() }));
vi.mock("viem", async (original) => ({ ...await original<typeof import("viem")>(),
  createWalletClient: () => provider, createPublicClient: () => provider }));
import { createAdminDrip } from "./drip.js";

it("records a submitted hash before checking the drip receipt and distinguishes a revert", async () => {
  const saved: string[] = [];
  provider.writeContract.mockResolvedValue("0xknown");
  provider.waitForTransactionReceipt.mockImplementation(async () => {
    expect(saved).toEqual(["0xknown"]);
    return { status: "reverted" };
  });
  const drip = createAdminDrip({ adminKey: `0x${"1".repeat(64)}`, amountUsdc: "1" });
  await expect(drip("0x0000000000000000000000000000000000000001", undefined, async (h) => { saved.push(h); })).rejects.toMatchObject({ name: "DripReverted" });
});
