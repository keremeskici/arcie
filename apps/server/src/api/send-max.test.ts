import { expect, it } from "vitest";
import { DEMO_WALLET, testApp } from "../testkit.js";

it("quotes the exact maximum for the selected contact without a proposal, rounding the gas reserve up", async () => {
  const { call, kit, harness } = await testApp();
  kit.setBalance(DEMO_WALLET, "USDC", "3.000001");
  kit.estimateSend = async (_wallet, params) => {
    expect(params.to).toBe("0x1111111111111111111111111111111111111111");
    return { fee: { label: "Network fee", amount: "0.0100001", token: "USDC" } };
  };
  const quote = await call("GET", "/quotes/send-max?to=demo%3Aalice&token=USDC");
  expect(quote.status).toBe(200);
  expect(await quote.json()).toEqual({ amount: "2.99", feeChecked: true });
  expect(harness.intents.listForUser("demo", 10)).toHaveLength(0);
  const p = await call("POST", "/intents", { kind: "send", params: { amount: "all", to: "demo:alice", token: "USDC" } });
  expect((await p.json()).island.rows).toContainEqual({ label: "Amount", value: "2.99 USD" });
  expect(kit.calls).toEqual([]);
});

it("shows the balance before a recipient is known, then requires an exact fee and sufficient separate gas", async () => {
  const { call, kit } = await testApp();
  expect((await call("GET", "/quotes/send-max?to=Alice&token=USDC")).status).toBe(400);
  expect(await (await call("GET", "/quotes/send-max?token=USDC")).json()).toEqual({ amount: "100", feeChecked: false });
  kit.setBalance(DEMO_WALLET, "USDC", "0");
  expect((await call("GET", "/quotes/send-max?to=Bob&token=EURC")).status).toBe(400);
  kit.estimateSend = async () => ({ fee: { label: "Network fee", amount: null, token: null } });
  expect((await call("GET", "/quotes/send-max?to=Bob&token=EURC")).status).toBeGreaterThanOrEqual(400);
});

it("quotes a one-unit BTC balance without reserving the fee in BTC", async () => {
  const { call, kit } = await testApp();
  kit.setBalance(DEMO_WALLET, "cirBTC", "0.00000001");
  kit.estimateSend = async (_wallet, params) => {
    expect(params.amount).toBe("0.00000001");
    expect(params.to).toBe("0x1111111111111111111111111111111111111111");
    return { fee: { label: "Network fee", amount: "0.0035", token: "USDC" } };
  };
  const response = await call("GET", "/quotes/send-max?to=demo%3Aalice&token=cirBTC");
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ amount: "0.00000001", feeChecked: true });
  expect(kit.calls).toEqual([]);
});

it("serves the console Send form with a contacts dialog and a numeric, fee-checked maximum", async () => {
  const { call } = await testApp();
  const html = await (await call("GET", "/")).text();
  const form = html.split('id="tab-send"')[1]!.split('id="tab-swap"')[0]!;
  expect(form).toContain('id="btn-send-contacts"');
  expect(html).toContain('<dialog id="send-contacts-dialog"');
  expect(form).toContain('id="btn-send-all"');
  expect(form).not.toContain('send-contact-pills');
  expect(form).not.toContain('value=\'all\'');
  expect(html).toContain('/quotes/send-max?');
});
