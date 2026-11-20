import { describe, expect, it } from "vitest";
import { testApp } from "../testkit.js";

describe("checkout page and browser bundle", () => {
  it("serves a modal and valid browser script connected to voice islands", async () => {
    const { app } = await testApp();
    const response = await app.request("/");
    const html = await response.text();
    expect(html).toContain('<dialog id="onramp-dialog"');
    expect(html).toContain('void onramp.open(island)');
    expect(html).not.toContain("Simulate Callback");
    const bundle = await app.request("/assets/onramp.js");
    expect(bundle.status).toBe(200);
    expect(bundle.headers.get("content-type")).toContain("text/javascript");
    const code = await bundle.text();
    expect(code).toContain("setupOnramp");
    expect(code).toContain("https://onramp-sandbox.arc.io");
    expect(code).not.toContain("ONRAMP_API_KEY");
  });
});
