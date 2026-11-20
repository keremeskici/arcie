/**
 * pnpm provision [--fund <usdc>]
 * 1. Creates the Circle wallet set if CIRCLE_WALLET_SET_ID is empty (and writes it to .env).
 * 2. Seeds the db (demo user + a "recipient" user for smoke sends).
 * 3. Ensures one Circle wallet per user on Arc Testnet.
 * 4. Prints balances; with --fund, sends that much USDC from the ADMIN wallet to the demo wallet.
 */
import { ensureWallet, getChain, HOME_CHAIN } from "@arcie/appkit";
import { seed } from "@arcie/db";
import { createPublicClient, erc20Abi, formatUnits, http } from "viem";
import { createAdminDrip } from "../src/auth/drip.js";
import { privateKeyToAccount } from "viem/accounts";
import { appKit, circleClient, need, openDb, setEnv } from "./lib.js";

const ACCOUNT_TYPE = (process.env.WALLET_ACCOUNT_TYPE as "EOA" | "SCA" | undefined) ?? "EOA";
const fundArg = process.argv.indexOf("--fund");
const fundAmount = fundArg > -1 ? process.argv[fundArg + 1] : undefined;
// Check funding prerequisites before creating any external resources.
const adminKey = fundArg > -1 ? need("ADMIN_PRIVATE_KEY") : process.env.ADMIN_PRIVATE_KEY;
const admin = adminKey ? privateKeyToAccount(adminKey as `0x${string}`) : undefined;

const circle = circleClient();
if (!process.env.CIRCLE_WALLET_SET_ID) {
  const res = await circle.createWalletSet({ name: "arcie" });
  const id = res.data?.walletSet?.id;
  if (!id) throw new Error(`createWalletSet returned no id: ${JSON.stringify(res.data)}`);
  setEnv("CIRCLE_WALLET_SET_ID", id);
  console.log(`Created wallet set ${id} (saved to .env)`);
}
const walletSetId = need("CIRCLE_WALLET_SET_ID");

const { db, close } = openDb();
const demoId = process.env.DEMO_USER_ID ?? "demo";
await seed(db, { userId: demoId });
await seed(db, { userId: "recipient" });

const demo = await ensureWallet(db, circle, { userId: demoId, chain: HOME_CHAIN, walletSetId, accountType: ACCOUNT_TYPE });
const recipient = await ensureWallet(db, circle, { userId: "recipient", chain: HOME_CHAIN, walletSetId, accountType: ACCOUNT_TYPE });

const chain = getChain(HOME_CHAIN);
const rpc = process.env.ARC_RPC_URL ?? chain.rpcUrl;
const usdc = chain.tokens.USDC;
const pub = createPublicClient({ chain: chain.viemChain, transport: http(rpc) });

if (fundAmount) {
  const drip = createAdminDrip({ adminKey: need("ADMIN_PRIVATE_KEY") as `0x${string}`, rpcUrl: rpc, amountUsdc: fundAmount });
  const hash = await drip(demo.address);
  console.log(`Funded demo wallet with ${fundAmount} USDC: ${chain.explorerTx(hash)}`);
}

const adminUsdc = admin ? await pub.readContract({ address: usdc.address, abi: erc20Abi, functionName: "balanceOf", args: [admin.address] }) : null;
const kit = appKit();
console.log(JSON.stringify({
  accountType: ACCOUNT_TYPE,
  walletSetId,
  ...(admin && adminUsdc !== null ? { admin: { address: admin.address, usdc: formatUnits(adminUsdc, usdc.decimals) } } : {}),
  demo: { ...demo, balances: await kit.getBalances(demo) },
  recipient: { ...recipient, balances: await kit.getBalances(recipient) },
}, null, 2));
await close();
