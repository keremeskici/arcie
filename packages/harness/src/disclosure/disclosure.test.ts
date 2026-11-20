import { ArcieError, type ConfirmIsland, type RichText } from "@arcie/core";
import { describe, expect, it } from "vitest";
import { buildEarnConfirm } from "./earn.js";
import { BUTTONS, spokenPrompt } from "./prompt.js";
import { buildReceipt, nextStepFor } from "./receipt.js";
import { buildSendConfirm } from "./send.js";
import { buildSwapConfirm } from "./swap.js";

const EXPIRES = "2026-11-07T10:02:00.000Z";
const SUFFIX = "Say confirm, or tap the card.";
const words = (s: string) => s.trim().split(/\s+/).length;
const plain = (r: RichText) => r.map((s) => s.text).join("");

function expectConfirmBasics(c: ConfirmIsland) {
  expect(c.kind).toBe("confirm");
  expect(c.title.endsWith("?")).toBe(true);
  expect(c.spokenPrompt.endsWith(SUFFIX)).toBe(true);
  expect(words(c.spokenPrompt)).toBeLessThanOrEqual(25);
  expect(c.buttons).toEqual({ confirm: "I've checked the details; do it now.", cancel: "Don't do this." });
  expect(c.expiresAt).toBe(EXPIRES);
}

describe("spokenPrompt", () => {
  it("appends the two-channel offer", () => {
    expect(spokenPrompt("Send 5 USD to Bob.")).toBe(`Send 5 USD to Bob. ${SUFFIX}`);
  });

  it("throws when the prompt would exceed 25 words", () => {
    expect(() => spokenPrompt(Array(20).fill("word").join(" "))).toThrow();
  });

  it("exports the fixed button meanings", () => {
    expect(BUTTONS).toEqual({ confirm: "I've checked the details; do it now.", cancel: "Don't do this." });
  });
});

describe("buildSendConfirm", () => {
  const base = {
    intentId: "i1",
    amount: "5",
    token: "USDC" as const,
    recipientLabel: "Alice",
    recipientIsNew: false,
    fee: { label: "Network fee", amount: "0.003476734370375", token: "USDC" as const },
    adjustments: [],
    expiresAt: EXPIRES,
  };

  it("builds a question title, rows and the irreversibility risk", () => {
    const c = buildSendConfirm(base);
    expectConfirmBasics(c);
    expect(c.title).toBe("Send 5 USD to Alice?");
    expect(c.rows).toContainEqual({ label: "Network fee", value: "0.0035 USD", estimate: true });
    expect(c.risks).toEqual(["Onchain transfers can't be reversed."]);
    expect(plain(c.disclosure)).toContain("5 USD");
    expect(c.disclosure.some((s) => s.bold && s.text === "5 USD")).toBe(true);
  });

  it("shows an unknown fee as null, marked as an estimate", () => {
    const c = buildSendConfirm({ ...base, fee: { label: "Network fee", amount: null, token: "USDC" } });
    expect(c.rows).toContainEqual({ label: "Network fee", value: null, estimate: true });
  });

  it("flags a new recipient as a risk", () => {
    expect(buildSendConfirm({ ...base, recipientIsNew: true }).risks).toContain("This is a new recipient.");
  });

  it("carries the send-all adjustment into adjustments and the disclosure", () => {
    const adj = "Sending 9.99 USD: 0.01 USD stays behind to pay the network fee.";
    const c = buildSendConfirm({ ...base, amount: "9.99", adjustments: [adj] });
    expect(c.adjustments).toEqual([adj]);
    expect(plain(c.disclosure)).toContain(adj);
  });

  it("matches the snapshot", () => {
    expect(buildSendConfirm(base)).toMatchSnapshot();
  });
});

describe("buildSwapConfirm", () => {
  const base = {
    intentId: "i2",
    tokenIn: "USDC" as const,
    tokenOut: "EURC" as const,
    amountIn: "10",
    estimatedOut: "9.21",
    minOut: "9.1179",
    slippageBps: 100,
    fees: [
      { label: "Swap provider fee", amount: "0.0002", token: "USDC" as const },
      { label: "Network fee", amount: "0.0447391883943375", token: "USDC" as const },
    ],
    adjustments: [],
    expiresAt: EXPIRES,
  };

  it("names the estimate and the guaranteed minimum", () => {
    const c = buildSwapConfirm(base);
    expectConfirmBasics(c);
    expect(c.title).toBe("Swap 10 USD for about 9.21 EUR?");
    expect(c.rows).toContainEqual({ label: "You get about", value: "9.21 EUR", estimate: true });
    expect(c.rows).toContainEqual({ label: "At least", value: "9.1179 EUR" });
    expect(c.risks).toEqual([
      "Price can move before it settles; you'll get at least 9.1179 EUR or it won't go through.",
    ]);
  });

  it("matches the snapshot", () => {
    expect(buildSwapConfirm(base)).toMatchSnapshot();
  });
});

describe("buildEarnConfirm", () => {
  const base = {
    intentId: "i3",
    direction: "deposit" as const,
    vaultName: "Steakhouse USDC",
    amount: "20",
    token: "USDC" as const,
    apy: 0.042,
    fees: [{ label: "Network fee", amount: "0.011167125", token: "USDC" as const }],
    adjustments: [],
    expiresAt: EXPIRES,
  };

  it("discloses variable APY and the vault contract for deposits", () => {
    const c = buildEarnConfirm(base);
    expectConfirmBasics(c);
    expect(c.title).toBe("Put 20 USD into Steakhouse USDC?");
    expect(c.rows).toContainEqual({ label: "Current APY", value: "4.2%", estimate: true });
    expect(c.risks).toEqual(["APY is variable and not guaranteed.", "Your money sits in a vault contract until you withdraw."]);
  });

  it("titles withdrawals and shows the expected amount", () => {
    const c = buildEarnConfirm({ ...base, direction: "withdraw", expectedAmount: "19.99" });
    expect(c.title).toBe("Withdraw 20 USD from Steakhouse USDC?");
    expect(c.rows).toContainEqual({ label: "You get about", value: "19.99 USD", estimate: true });
  });

  it("keeps the spoken prompt within 25 words even for a long vault name", () => {
    const c = buildEarnConfirm({ ...base, vaultName: "EarnKit USDC Vault (Arc Testnet) Extra Long Institutional Edition Name" });
    expect(words(c.spokenPrompt)).toBeLessThanOrEqual(25);
    expect(c.spokenPrompt.endsWith(SUFFIX)).toBe(true);
  });

  it("shows an unknown APY as null", () => {
    expect(buildEarnConfirm({ ...base, apy: null }).rows).toContainEqual({ label: "Current APY", value: null, estimate: true });
  });

  it("matches the snapshot", () => {
    expect(buildEarnConfirm(base)).toMatchSnapshot();
  });
});

describe("buildReceipt", () => {
  it("puts the estimated and actual output side by side", () => {
    const r = buildReceipt({
      intentId: "i2",
      status: "succeeded",
      estimated: { "You got": "9.21 EUR" },
      actual: { "You got": "9.20 EUR" },
      txHash: "0xabc",
      explorerUrl: "https://testnet.arcscan.app/tx/0xabc",
      elapsedMs: 5200,
    });
    expect(r.rows).toEqual([{ label: "You got", estimated: "9.21 EUR", actual: "9.20 EUR" }]);
    expect(r.txHash).toBe("0xabc");
  });

  it("carries the error code and spoken message on failure", () => {
    const err = new ArcieError("SLIPPAGE_EXCEEDED");
    const r = buildReceipt({ intentId: "i2", status: "failed", estimated: {}, actual: {}, elapsedMs: 100, error: err });
    expect(r.error).toEqual({ code: "SLIPPAGE_EXCEEDED", message: err.spoken });
  });

  it("matches the snapshot", () => {
    expect(
      buildReceipt({
        intentId: "i1",
        status: "succeeded",
        estimated: { Sent: "5 USD", "Network fee": "0.0035 USD" },
        actual: { Sent: "5 USD", "Network fee": null },
        txHash: "0xdef",
        explorerUrl: "https://testnet.arcscan.app/tx/0xdef",
        newBalance: "4.89 USD",
        elapsedMs: 3100,
      }),
    ).toMatchSnapshot();
  });
});

describe("nextStepFor", () => {
  it("suggests savings only after a swap into USD", () => {
    expect(nextStepFor("swap", { tokenOut: "USDC" })).toEqual({ label: "Add to savings", utterance: "I want to add USD to savings" });
    expect(nextStepFor("swap", { tokenOut: "EURC" })).toBeUndefined();
  });

  it("suggests checking earnings after a deposit", () => {
    expect(nextStepFor("earn_deposit", {})).toEqual({ label: "Check my earnings", utterance: "how are my earnings" });
  });

  it("suggests nothing after a send", () => {
    expect(nextStepFor("send", {})).toBeUndefined();
  });
});
