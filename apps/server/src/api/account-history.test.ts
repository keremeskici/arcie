import { audit } from "@arcie/db";
import { expect, it } from "vitest";
import { testApp } from "../testkit.js";

it("returns actionable contact field errors and preserves the duplicate-name error", async () => {
  const { call } = await testApp();
  const address = "0x000000000000000000000000000000000000dEaD";
  for (const [body, expected] of [
    [{ name: "  ", address }, /name.*60/i],
    [{ name: "A".repeat(61), address }, /name.*60/i],
    [{ name: "Alice's friend" }, /checksum/i],
    [{ name: "Alice's friend", address: address.toLowerCase() }, /checksum/i],
    [{ name: "Bob", address }, /already.*name/i],
  ] as const) {
    const response = await call("POST", "/contacts", body);
    expect(response.status).toBe(400);
    expect((await response.json()).error).toMatchObject({ code: "INVALID_RECIPIENT", message: expect.stringMatching(expected) });
  }
});

it("returns the latest 50 user-visible activity entries even after many internal tool calls", async () => {
  const { call, db } = await testApp();
  const row = { userId: "demo", payload: {} };
  await db.insert(audit).values([
    ...Array.from({ length: 52 }, (_, i) => ({ ...row, type: "intent.proposed", intentId: `intent-${i}` })),
    { ...row, type: "onramp.submitted" },
    ...Array.from({ length: 50 }, () => ({ ...row, type: "tool.call" })),
    { ...row, userId: "other-user", type: "intent.confirmed", intentId: "other-intent" },
  ]);
  const { items } = await (await call("GET", "/activity")).json();
  expect(items).toHaveLength(50);
  expect(items[0]).toMatchObject({ type: "onramp.submitted", intentId: null });
  expect(items[1].intentId).toBe("intent-51");
  expect(items.at(-1).intentId).toBe("intent-3");
  expect(items).not.toContainEqual(expect.objectContaining({ intentId: "other-intent" }));
});
