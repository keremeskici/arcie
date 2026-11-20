import { getChain, HOME_CHAIN } from "@arcie/appkit";
import { createPublicClient, createWalletClient, erc20Abi, http, parseUnits } from "viem";
import { privateKeyToAccount } from "viem/accounts";

export class DripReverted extends Error {
  override name = "DripReverted";
}

/** USDC transfer from the testnet admin wallet; used for the welcome drip and `pnpm provision --fund`. */
export function createAdminDrip(cfg: { adminKey: `0x${string}`; rpcUrl?: string | undefined; amountUsdc: string }) {
  const chain = getChain(HOME_CHAIN);
  const transport = http(cfg.rpcUrl ?? chain.rpcUrl);
  const account = privateKeyToAccount(cfg.adminKey);
  const wallet = createWalletClient({ account, chain: chain.viemChain, transport });
  const pub = createPublicClient({ chain: chain.viemChain, transport });
  const usdc = chain.tokens.USDC;

  return async (to: `0x${string}`, amount = cfg.amountUsdc, submitted?: (hash: string) => Promise<void>): Promise<string> => {
    const hash = await wallet.writeContract({
      address: usdc.address,
      abi: erc20Abi,
      functionName: "transfer",
      args: [to, parseUnits(amount, usdc.decimals)],
    });
    await submitted?.(hash);
    const receipt = await pub.waitForTransactionReceipt({ hash });
    if (receipt.status === "reverted") throw new DripReverted();
    if (receipt.status !== "success") throw new Error("Drip receipt unavailable");
    return hash;
  };
}
