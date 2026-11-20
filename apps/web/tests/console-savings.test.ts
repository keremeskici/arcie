// @vitest-environment node
import { trackBrowserRequests } from "./server-dom";
import { fireEvent, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { testApp } from "../../server/src/testkit";

let backend: Awaited<ReturnType<typeof testApp>>;
let browser: ReturnType<typeof trackBrowserRequests>;
const id = (name: string) => document.getElementById(name)!;
class OfflineEvents extends EventTarget { close() {} }

beforeEach(async () => {
  backend = await testApp();
  const html = await (await backend.app.request("/")).text();
  const page = new DOMParser().parseFromString(html, "text/html");
  const script = page.querySelector('script[type="module"]')!;
  const code = script.textContent.replace('import { setupOnramp } from "/assets/onramp.js";', "");
  script.remove();
  document.body.innerHTML = page.body.innerHTML;
  vi.stubGlobal("EventSource", OfflineEvents);
  browser = trackBrowserRequests((path, init) => backend.app.request(path, init));
  vi.stubGlobal("fetch", browser.fetch);
  // Exercise the served console, leaving the unrelated hosted checkout and external SDKs offline.
  await Function("setupOnramp", code.replace("    boot();", "    return boot();"))(() => ({}));
});
afterEach(async () => { await browser.drain(); document.body.replaceChildren(); vi.unstubAllGlobals(); });

it("renders one savings account and reviews deposits, partial withdrawals and full withdrawals", async () => {
  const tab = [...document.querySelectorAll("button")].find(b => b.textContent.includes("4. Savings"));
  expect(tab).toBeTruthy();
  fireEvent.click(tab!);
  const amount = id("savings-amount") as HTMLInputElement;
  const deposit = id("savings-deposit") as HTMLButtonElement;
  const withdraw = id("savings-withdraw") as HTMLButtonElement;
  const all = id("savings-withdraw-all") as HTMLButtonElement;
  await waitFor(() => expect(id("savings-balance").textContent).toBe("$0.00"));
  expect(id("savings-rate").textContent).toBe("4.2%");
  expect(id("savings-earned").textContent).toBe("$0.00");
  expect(id("tab-earn").textContent).not.toMatch(/vault|apy|fake/i);
  expect(all.disabled).toBe(true);
  fireEvent.input(amount, { target: { value: "2.50" } });
  fireEvent.click(deposit);
  await waitFor(() => expect(id("island-active").textContent).toMatch(/Add 2\.50 USD to savings/i));
  expect(backend.kit.calls).toEqual([]);
  fireEvent.click(id("btn-card-confirm"));
  await waitFor(() => expect(id("savings-balance").textContent).toBe("$2.50"));
  fireEvent.input(amount, { target: { value: "1" } });
  fireEvent.click(withdraw);
  await waitFor(() => expect(id("island-active").textContent).toMatch(/Withdraw 1 USD from savings/i));
  fireEvent.click(id("btn-card-cancel"));
  await waitFor(() => expect(id("btn-card-confirm")).toBeNull());
  fireEvent.click(all);
  await waitFor(() => expect(id("island-active").textContent).toMatch(/Withdraw 2\.5 USD from savings/i));
  expect(backend.kit.calls.map(c => c.method)).toEqual(["deposit"]);
});
