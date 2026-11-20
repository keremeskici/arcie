import { ArcieError } from "@arcie/core";
import { createDb, seed, type Db } from "@arcie/db";
import { beforeEach, describe, expect, it } from "vitest";
import { paramsHash } from "./hash.js";
import { assertConfirmable } from "./machine.js";
import { IntentRepo, type IntentDraft } from "./repo.js";

const T0 = new Date("2026-11-07T10:00:00.000Z");
const at = (sec: number) => new Date(T0.getTime() + sec * 1000);

function draft(over: Partial<IntentDraft> = {}): IntentDraft {
  return {
    sessionId: "s1",
    userId: "demo",
    kind: "send",
    chain: "Arc_Testnet",
    params: { to: "0x3333333333333333333333333333333333333333", amount: "5", token: "USDC" },
    preview: {},
    status: "awaiting_confirmation",
    usdValue: "5",
    previewTurn: 2,
    now: T0,
    ttlSec: 120,
    ...over,
  };
}

function caught(fn: () => void): ArcieError {
  try {
    fn();
  } catch (e) {
    return e as ArcieError;
  }
  throw new Error("expected a throw");
}

let db: Db;
let repo: IntentRepo;
beforeEach(async () => {
  db = createDb(":memory:");
  await seed(db, { userId: "demo" });
  repo = new IntentRepo(db);
});

describe("paramsHash", () => {
  it("is independent of key order", () => {
    expect(paramsHash({ a: 1, b: { c: 2, d: 3 } })).toBe(paramsHash({ b: { d: 3, c: 2 }, a: 1 }));
  });

  it("changes when a value changes", () => {
    expect(paramsHash({ amount: "5" })).not.toBe(paramsHash({ amount: "6" }));
  });
});

describe("IntentRepo", () => {
  it("creates an intent with hash, quote time and expiry", () => {
    const i = repo.create(draft());
    expect(i.paramsHash).toBe(paramsHash(draft().params));
    expect(i.quoteAt).toBe(T0.toISOString());
    expect(i.expiresAt).toBe(at(120).toISOString());
    expect(repo.get(i.id)).toEqual(i);
  });

  it("lets exactly one of two concurrent transitions win (at-most-once)", async () => {
    const i = repo.create(draft());
    const results = await Promise.all([
      Promise.resolve().then(() => repo.transition(i.id, "awaiting_confirmation", "executing", { confirmedVia: "voice" })),
      Promise.resolve().then(() => repo.transition(i.id, "awaiting_confirmation", "executing", { confirmedVia: "screen" })),
    ]);
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(repo.get(i.id)?.status).toBe("executing");
  });

  it("finds the open intent for a session, ignoring expired ones", () => {
    const i = repo.create(draft());
    expect(repo.openForSession("s1", at(60))?.id).toBe(i.id);
    expect(repo.openForSession("s1", at(121))).toBeNull();
    expect(repo.openForSession("other", at(60))).toBeNull();
  });

  it("supersedes the open intent when a new one is proposed", () => {
    const old = repo.create(draft());
    const next = repo.create(draft({ params: { amount: "6" } }));
    repo.supersedeOpen("s1", next.id);
    const o = repo.get(old.id)!;
    expect(o.status).toBe("cancelled");
    expect(o.statusReason).toBe("superseded");
    expect(o.supersededBy).toBe(next.id);
    expect(repo.get(next.id)?.status).toBe("awaiting_confirmation");
  });

  it("sums only succeeded intents from the last 24 hours", () => {
    const a = repo.create(draft({ usdValue: "10" }));
    repo.transition(a.id, "awaiting_confirmation", "succeeded");
    const b = repo.create(draft({ usdValue: "7" }));
    repo.transition(b.id, "awaiting_confirmation", "failed");
    const old = repo.create(draft({ usdValue: "100", now: new Date(T0.getTime() - 25 * 3600_000) }));
    repo.transition(old.id, "awaiting_confirmation", "succeeded");
    repo.create(draft({ usdValue: "3" })); // still pending
    expect(repo.spentTodayUsd("demo", T0)).toBe(10);
  });
});

describe("assertConfirmable", () => {
  it("rejects a missing intent with NOT_FOUND", () => {
    expect(caught(() => assertConfirmable(null, { channel: "screen", userTurn: 3, now: T0 })).code).toBe("NOT_FOUND");
  });

  it("refuses a voice confirmation in the same turn as the preview (new-turn rule)", () => {
    const i = repo.create(draft({ previewTurn: 2 }));
    const err = caught(() => assertConfirmable(i, { channel: "voice", userTurn: 2, now: at(5) }));
    expect(err.code).toBe("POLICY_DENIED");
    expect(err.spoken).toMatch(/say confirm after hearing the details/i);
  });

  it("accepts a voice confirmation on the next user turn", () => {
    const i = repo.create(draft({ previewTurn: 2 }));
    expect(() => assertConfirmable(i, { channel: "voice", userTurn: 3, now: at(5) })).not.toThrow();
  });

  it("accepts a screen confirmation in the same turn", () => {
    const i = repo.create(draft({ previewTurn: 2 }));
    expect(() => assertConfirmable(i, { channel: "screen", userTurn: 2, now: at(5) })).not.toThrow();
  });

  it("treats a yes after the TTL as an expired quote and offers a fresh one (Review Focus 2)", () => {
    const i = repo.create(draft());
    const err = caught(() => assertConfirmable(i, { channel: "screen", userTurn: 3, now: at(121) }));
    expect(err.code).toBe("QUOTE_EXPIRED");
    expect(err.spoken).toMatch(/fresh/i);
  });

  it("rejects a superseded intent with NOT_FOUND", () => {
    const old = repo.create(draft());
    const next = repo.create(draft());
    repo.supersedeOpen("s1", next.id);
    const err = caught(() => assertConfirmable(repo.get(old.id), { channel: "screen", userTurn: 3, now: at(5) }));
    expect(err.code).toBe("NOT_FOUND");
    expect(err.spoken).toMatch(/replaced or cancelled/i);
  });

  it("rejects an intent that already ran", () => {
    const i = repo.create(draft());
    repo.transition(i.id, "awaiting_confirmation", "succeeded");
    const err = caught(() => assertConfirmable(repo.get(i.id), { channel: "screen", userTurn: 3, now: at(5) }));
    expect(err.code).toBe("NOT_FOUND");
    expect(err.detail).toMatchObject({ alreadyHandled: true });
  });
});
