import { ArcieError } from "@arcie/core";
import { describe, expect, it } from "vitest";
import { FakeAppKit } from "./fake.js";
import type { WalletRef } from "./port.js";

const w: WalletRef = {
  chain: "Arc_Testnet",
  address: "0x000000000000000000000000000000000000dEaD",
  circleWalletId: "wallet-1",
};
const bob = "0x3333333333333333333333333333333333333333" as const;

async function balanceOf(kit: FakeAppKit, token: string) {
  return (await kit.getBalances(w)).find((b) => b.token === token)?.amount;
}

describe("FakeAppKit", () => {
  it("deducts the amount plus the USDC gas fee on send", async () => {
    const kit = new FakeAppKit();
    kit.setBalance(w, "USDC", "10");
    const res = await kit.send(w, { to: bob, amount: "4", token: "USDC" });
    expect(res.status).toBe("DONE");
    expect(res.txHash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(await balanceOf(kit, "USDC")).toBe("5.99");
  });

  it("swaps at the configured rate", async () => {
    const kit = new FakeAppKit();
    kit.setBalance(w, "USDC", "10");
    kit.setSwapRate("USDC", "EURC", 0.92);
    const est = await kit.estimateSwap(w, { tokenIn: "USDC", tokenOut: "EURC", amountIn: "10", slippageBps: 100 });
    expect(est.estimatedOut).toBe("9.2");
    expect(est.minOut).toBe("9.108");
    const res = await kit.swap(w, { tokenIn: "USDC", tokenOut: "EURC", amountIn: "5", slippageBps: 100 });
    expect(res.amountOut).toBe("4.6");
    expect(await balanceOf(kit, "EURC")).toBe("4.6");
  });

  it("fails the next call with the given code", async () => {
    const kit = new FakeAppKit();
    kit.setBalance(w, "USDC", "10");
    kit.failNext("SLIPPAGE_EXCEEDED");
    const err = await kit
      .swap(w, { tokenIn: "USDC", tokenOut: "EURC", amountIn: "1", slippageBps: 100 })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ArcieError);
    expect((err as ArcieError).code).toBe("SLIPPAGE_EXCEEDED");
    // only the next call fails
    await expect(kit.send(w, { to: bob, amount: "1", token: "USDC" })).resolves.toMatchObject({ status: "DONE" });
  });

  it("rejects a send larger than the balance", async () => {
    const kit = new FakeAppKit();
    kit.setBalance(w, "USDC", "1");
    await expect(kit.send(w, { to: bob, amount: "5", token: "USDC" })).rejects.toMatchObject({
      code: "INSUFFICIENT_BALANCE",
    });
  });

  it("deposits into and withdraws from a vault", async () => {
    const kit = new FakeAppKit();
    kit.setBalance(w, "USDC", "10");
    const [vault] = await kit.listVaults("Arc_Testnet", "USDC");
    await kit.deposit(w, { vault: vault!.address, amount: "4" });
    expect((await kit.getPosition(w, vault!.address))?.currentBalance).toBe("4");
    await kit.withdraw(w, { vault: vault!.address, amount: "4" });
    expect(await kit.getPosition(w, vault!.address)).toBeNull();
  });

  it("reports a pending swap until it is settled", async () => {
    const kit = new FakeAppKit();
    kit.setBalance(w, "USDC", "10");
    kit.setPendingNext();
    const res = await kit.swap(w, { tokenIn: "USDC", tokenOut: "EURC", amountIn: "1", slippageBps: 100 });
    expect(res.status).toBe("PENDING");
    kit.settle(res.txHash);
    expect((await kit.waitForSwap(w, res.txHash, 1000)).status).toBe("DONE");
  });
});
