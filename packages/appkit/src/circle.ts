import { ArcieError, type ChainId, type TokenSymbol } from "@arcie/core";
import { AppKit } from "@circle-fin/app-kit";
import { createAppServerKit } from "@circle-fin/app-kit/server";
import { createRequire } from "node:module";
import { createPublicClient, erc20Abi, formatUnits, http, type PublicClient } from "viem";
import { getChain } from "./chains.js";
import { mapKitError } from "./errors.js";
import { nativeFeeToGasToken, pickUsdRates, swapFeeLabel } from "./normalize.js";
import type { AppKitPort, Fee, Position, SendParams, SwapParams, TxResult, Vault, VaultAmount, WalletRef } from "./port.js";

// The Wallets adapter's ESM entry loads an SDK file that requires Node's syntax detection.
// Use its CommonJS export so the same adapter works in Vercel's Node runtime.
const require = createRequire(import.meta.url);
const { createCircleWalletsAdapter } = require("@circle-fin/adapter-circle-wallets") as
  typeof import("@circle-fin/adapter-circle-wallets");

export interface CircleAppKitConfig {
  circleApiKey: string;
  entitySecret: string;
  onrampApiKey: string;
  onrampEnvironment?: "sandbox" | "production";
  /** Optional Circle API key with the "App Kits" permission (swap/earn rate limits). */
  appKitApiKey?: string;
  referrerDomain?: string;
  /** Per-chain RPC override (e.g. Alchemy); falls back to the registry's public RPC. */
  rpcUrls?: Partial<Record<ChainId, string>>;
}

/** Loose view of provider fee items; App Kit's fee shapes differ per capability. */
type AnyFee = { type?: string; name?: string; label?: string; symbol?: string; token?: string; amount?: unknown };

/** Swap and vault fees arrive as human-readable amounts (verified live). */
function toFee(f: AnyFee, fallbackLabel: string, gasToken: TokenSymbol): Fee {
  const amount = f.amount == null ? null : String(f.amount);
  const symbol = (f.symbol ?? f.token ?? gasToken) as TokenSymbol;
  const label = f.label ?? f.name ?? (f.type ? swapFeeLabel(f.type) : fallbackLabel);
  return { label, amount, token: symbol };
}

/** Earn gas estimates: one entry per tx step, in native base units; `fees: null` before an approval exists ("—"). */
function gasFees(list: readonly { fees: { fee: string } | null }[] | undefined, chain: ChainId): Fee[] {
  const gasToken = getChain(chain).gasToken;
  const steps = list ?? [];
  if (steps.some((g) => g.fees === null)) return [{ label: "Network fee", amount: null, token: gasToken }];
  const total = steps.reduce((sum, g) => sum + BigInt(g.fees!.fee), 0n);
  return steps.length ? [{ label: "Network fee", amount: nativeFeeToGasToken(total.toString(), chain), token: gasToken }] : [];
}

function txResult(chain: ChainId, txHash: string, explorerUrl?: string, status: TxResult["status"] = "DONE"): TxResult {
  return { txHash, explorerUrl: explorerUrl ?? getChain(chain).explorerTx(txHash), status };
}

function swapStatus(s: string | undefined): TxResult["status"] {
  if (s === "DONE") return "DONE";
  if (s === "FAILED") return "FAILED";
  return "PENDING"; // NOT_FOUND establishes neither success nor failure.
}

async function guard<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    throw mapKitError(e);
  }
}

export function createCircleAppKit(cfg: CircleAppKitConfig): AppKitPort {
  const onrampEnvironment = cfg.onrampEnvironment ?? "sandbox";
  if ((onrampEnvironment === "sandbox" && cfg.onrampApiKey.startsWith("LIVE_API_KEY:")) ||
      (onrampEnvironment === "production" && cfg.onrampApiKey.startsWith("TEST_API_KEY:"))) {
    throw new Error("ONRAMP_API_KEY does not match ONRAMP_ENVIRONMENT.");
  }
  const kit = new AppKit();
  const adapter = createCircleWalletsAdapter({ apiKey: cfg.circleApiKey, entitySecret: cfg.entitySecret });
  const server = createAppServerKit({
    onramp: {
      apiKey: cfg.onrampApiKey,
      baseUrl: onrampEnvironment === "sandbox" ? "https://api-test.circle.com" : "https://api.circle.com",
      widgetBaseUrl: onrampEnvironment === "sandbox" ? "https://onramp-sandbox.arc.io" : "https://onramp.arc.io",
      ...(cfg.referrerDomain ? { referrerDomain: cfg.referrerDomain } : {}),
    },
  });
  const apiKey = cfg.appKitApiKey ? { apiKey: cfg.appKitApiKey } : {};
  const clients = new Map<ChainId, PublicClient>();

  const from = (w: WalletRef) => ({ adapter, chain: w.chain, address: w.address });

  function publicClient(id: ChainId): PublicClient {
    let c = clients.get(id);
    if (!c) {
      const cfgChain = getChain(id);
      const rpcUrl = cfg.rpcUrls?.[id] ?? cfgChain.rpcUrl;
      c = createPublicClient({ chain: cfgChain.viemChain, transport: http(rpcUrl, { retryCount: 3, timeout: 10_000 }) });
      clients.set(id, c);
    }
    return c;
  }

  return {
    getBalances: (w) =>
      guard(async () => {
        const { tokens } = getChain(w.chain);
        const client = publicClient(w.chain);
        return Promise.all(
          (Object.keys(tokens) as TokenSymbol[]).map(async (token) => {
            const t = tokens[token];
            const units = await client.readContract({
              address: t.address,
              abi: erc20Abi,
              functionName: "balanceOf",
              args: [w.address],
            });
            return { token, amount: formatUnits(units, t.decimals) };
          }),
        );
      }),

    getUsdRates: (chain, tokens) =>
      guard(async () => {
        const { rates } = await kit.getTokenRates({ chain, tokens, ...apiKey } as never);
        return pickUsdRates(rates, chain, tokens);
      }),

    estimateSend: (w, p: SendParams) =>
      guard(async () => {
        const est = await kit.estimateSend({ from: from(w), to: p.to, amount: p.amount, token: p.token } as never);
        const gasToken = getChain(w.chain).gasToken;
        return { fee: { label: "Network fee", amount: nativeFeeToGasToken(est.fee, w.chain), token: gasToken } };
      }),

    send: (w, p: SendParams) =>
      guard(async () => {
        const res = (await kit.send({ from: from(w), to: p.to, amount: p.amount, token: p.token } as never)) as {
          txHash?: string;
          explorerUrl?: string;
          steps?: { txHash?: string; explorerUrl?: string }[];
        };
        const step = res.steps?.find((s) => s.txHash);
        const txHash = res.txHash ?? step?.txHash;
        if (!txHash) throw new ArcieError("UNKNOWN", { detail: { sendResult: res } });
        return txResult(w.chain, txHash, res.explorerUrl ?? step?.explorerUrl, "PENDING");
      }),

    estimateSwap: (w, p: SwapParams) =>
      guard(async () => {
        const est = await kit.estimateSwap({
          from: from(w),
          tokenIn: p.tokenIn,
          tokenOut: p.tokenOut,
          amountIn: p.amountIn,
          config: { slippageBps: p.slippageBps, ...apiKey },
        } as never);
        return {
          estimatedOut: est.estimatedOutput.amount,
          minOut: est.stopLimit.amount,
          fees: (est.fees ?? []).map((f) => toFee(f as AnyFee, "Swap fee", getChain(w.chain).gasToken)),
        };
      }),

    swap: (w, p: SwapParams) =>
      guard(async () => {
        const res = await kit.swap({
          from: from(w),
          tokenIn: p.tokenIn,
          tokenOut: p.tokenOut,
          amountIn: p.amountIn,
          config: { slippageBps: p.slippageBps, ...(p.minOut !== undefined ? { stopLimit: p.minOut } : {}), ...apiKey },
        } as never);
        const out = txResult(w.chain, res.txHash, res.explorerUrl, swapStatus(res.progress?.status));
        if (res.amountOut) out.amountOut = res.amountOut;
        return out;
      }),

    readTransaction: async (id, txHash, timeoutMs) => {
      const chain = getChain(id);
      const reader = createPublicClient({ chain: chain.viemChain, transport: http(cfg.rpcUrls?.[id] ?? chain.rpcUrl, { retryCount: 0, timeout: timeoutMs }) });
      const receipt = await reader.getTransactionReceipt({ hash: txHash as `0x${string}` }).catch(() => null);
      if (!receipt || receipt.transactionHash.toLowerCase() !== txHash.toLowerCase()) return "PENDING";
      return receipt.status === "success" ? "DONE" : receipt.status === "reverted" ? "FAILED" : "PENDING";
    },

    waitForSwap: (w, txHash, timeoutMs) =>
      guard(async () => {
        const st = await kit.waitForSwap({ txHash, chainIn: w.chain, timeoutMs, ...apiKey } as never);
        if (st.source?.txHash != null && st.source.txHash.toLowerCase() !== txHash.toLowerCase()) return txResult(w.chain, txHash, undefined, "PENDING");
        const out = txResult(w.chain, txHash, undefined, swapStatus(st.progress?.status));
        if (st.destination?.amount) out.amountOut = st.destination.amount;
        return out;
      }),

    listVaults: (chain, token) =>
      guard(async () => {
        const { vaults } = await kit.earn.exploreVaults({ chain, sortBy: "apy", ...apiKey } as never);
        return vaults
          .filter((v) => v.status === "active")
          .map((v): Vault => ({
            address: v.vaultAddress as `0x${string}`,
            name: v.name,
            token: v.asset as TokenSymbol,
            apy: v.currentApy,
          }))
          .filter((v) => !token || v.token === token);
      }),

    getDepositQuote: (w, p: VaultAmount) =>
      guard(async () => {
        const q = await kit.earn.getDepositQuote({ from: from(w), vaultAddress: p.vault, amount: p.amount, ...apiKey } as never);
        const gasToken = getChain(w.chain).gasToken;
        return {
          vaultName: q.vaultName,
          apy: q.currentApy,
          fees: [...q.fees.map((f) => toFee(f as AnyFee, "Vault fee", gasToken)), ...gasFees(q.gasFees as never, w.chain)],
        };
      }),

    deposit: (w, p: VaultAmount) =>
      guard(async () => {
        const res = await kit.earn.deposit({ from: from(w), vaultAddress: p.vault, amount: p.amount, ...apiKey } as never);
        return txResult(w.chain, res.txHash, res.explorerUrl, "PENDING");
      }),

    getWithdrawalQuote: (w, p: VaultAmount) =>
      guard(async () => {
        const q = await kit.earn.getWithdrawalQuote({ from: from(w), vaultAddress: p.vault, amount: p.amount, ...apiKey } as never);
        const gasToken = getChain(w.chain).gasToken;
        return {
          expectedAmount: q.withdrawal.amount,
          fees: [...q.fees.map((f) => toFee(f as AnyFee, "Circle fee", gasToken)), ...gasFees(q.gasFees as never, w.chain)],
        };
      }),

    withdraw: (w, p: VaultAmount) =>
      guard(async () => {
        const res = await kit.earn.withdraw({ from: from(w), vaultAddress: p.vault, amount: p.amount, ...apiKey } as never);
        return txResult(w.chain, res.txHash, res.explorerUrl, "PENDING");
      }),

    getPosition: (w, vault) =>
      guard(async (): Promise<Position | null> => {
        let pos;
        try {
          pos = await kit.earn.getPosition({ from: from(w), vaultAddress: vault, ...apiKey } as never);
        } catch (e) {
          if (e instanceof Error && /position is not registered/i.test(e.message)) return null;
          throw e;
        }
        if (!pos || Number(pos.currentBalance) === 0) return null;
        const pnl = pos.pnl as { status: string; totalYieldEarned?: string };
        return {
          vaultName: (pos as { vaultName?: string }).vaultName ?? "Vault",
          currentBalance: pos.currentBalance,
          apy: (pos as { currentApy?: number }).currentApy ?? 0,
          yieldEarned: pnl.status === "available" ? (pnl.totalYieldEarned ?? null) : null,
        };
      }),

    createOnrampSession: (p) =>
      guard(async () => {
        try {
          const s = await server.onramp.createSession({
            appUserId: p.appUserId,
            destinationAddress: p.destinationAddress,
            ...(p.amount ? { amount: p.amount, currency: p.token === "EURC" ? "EUR" : "USD" } : {}),
            // Keep sandbox networks available for provider testing. Production is Arc-only.
            assets: { tokens: [p.token], ...(onrampEnvironment === "production" ? { chains: ["arc"] } : {}) },
          });
          // The sandbox can omit sessionId despite the SDK declaration. Never invent
          // one: the browser SDK compares it against IDs in provider messages.
          return { ...(s.sessionId ? { sessionId: s.sessionId } : {}), sessionToken: s.sessionToken, widgetUrl: s.widgetUrl, expiresAt: s.expiresAt, environment: onrampEnvironment };
        } catch (e) {
          const mapped = mapKitError(e);
          throw mapped.code === "UNKNOWN" ? new ArcieError("ONRAMP_ERROR", { detail: e }) : mapped;
        }
      }),
  };
}
