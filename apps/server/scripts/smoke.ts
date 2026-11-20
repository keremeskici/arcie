/**
 * pnpm smoke — exercises every AppKitPort method against Arc Testnet with the demo wallet.
 * Each step is independent: a failure is logged (with the mapped ArcieError) and the run continues.
 */
import { getWallet, HOME_CHAIN } from "@arcie/appkit";
import { ArcieError } from "@arcie/core";
import { appKit, openDb } from "./lib.js";

const db = openDb();
const demo = await getWallet(db, process.env.DEMO_USER_ID ?? "demo", HOME_CHAIN);
const recipient = await getWallet(db, "recipient", HOME_CHAIN);
if (!demo || !recipient) throw new Error("Run `pnpm provision` first.");

const kit = appKit();
const results: { step: string; ok: boolean; ms: number; out?: unknown; error?: unknown }[] = [];

async function step<T>(name: string, fn: () => Promise<T>): Promise<T | undefined> {
  const t0 = Date.now();
  try {
    const out = await fn();
    results.push({ step: name, ok: true, ms: Date.now() - t0, out });
    console.log(`✔ ${name} (${Date.now() - t0}ms)`, JSON.stringify(out));
    return out;
  } catch (e) {
    const err = e instanceof ArcieError ? { code: e.code, spoken: e.spoken, detail: String((e.detail as Error)?.message ?? e.detail) } : String(e);
    results.push({ step: name, ok: false, ms: Date.now() - t0, error: err });
    console.log(`✘ ${name} (${Date.now() - t0}ms)`, JSON.stringify(err));
    return undefined;
  }
}

await step("balances", () => kit.getBalances(demo));
await step("usd rates USDC/EURC", () => kit.getUsdRates(HOME_CHAIN, ["USDC", "EURC"]));

const sendParams = { to: recipient.address, amount: "1", token: "USDC" as const };
await step("estimateSend 1 USDC", () => kit.estimateSend(demo, sendParams));
await step("send 1 USDC", () => kit.send(demo, sendParams));

const swapParams = { tokenIn: "USDC" as const, tokenOut: "EURC" as const, amountIn: "1", slippageBps: 100 };
await step("estimateSwap 1 USDC→EURC", () => kit.estimateSwap(demo, swapParams));
const swap = await step("swap 1 USDC→EURC", () => kit.swap(demo, swapParams));
if (swap) await step("waitForSwap", () => kit.waitForSwap(demo, swap.txHash, 60_000));

const vaults = await step("listVaults USDC", () => kit.listVaults(HOME_CHAIN, "USDC"));
const vault = vaults?.[0];
if (vault) {
  const p = { vault: vault.address, amount: "1" };
  await step(`getDepositQuote 1 USDC → ${vault.name}`, () => kit.getDepositQuote(demo, p));
  await step("deposit 1 USDC", () => kit.deposit(demo, p));
  // The position indexer lags a few seconds behind the deposit tx.
  const pos = await step("getPosition (after indexing)", async () => {
    for (let i = 0; i < 10; i++) {
      const p = await kit.getPosition(demo, vault.address);
      if (p) return p;
      await new Promise((r) => setTimeout(r, 2000));
    }
    return null;
  });
  if (pos) {
    const w = { vault: vault.address, amount: pos.currentBalance };
    await step(`getWithdrawalQuote ${pos.currentBalance}`, () => kit.getWithdrawalQuote(demo, w));
    await step("withdraw full position", () => kit.withdraw(demo, w));
  }
}

await step("createOnrampSession (sandbox)", () =>
  kit.createOnrampSession({ appUserId: "demo", destinationAddress: demo.address, token: "USDC" }),
);
await step("balances after", () => kit.getBalances(demo));

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} steps passed`);
process.exitCode = failed.length ? 1 : 0;
