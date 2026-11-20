import { sessions } from "@arcie/db";
import { describe, expect, it, vi } from "vitest";
import { testApp } from "../testkit.js";

describe("event credential lifetime (F16)", () => {
  it.each(["island", "idle"])("closes an expired stream before its next %s event", async (trigger) => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-07T10:00:00Z"));
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    try {
      const { app, db, events } = await testApp({ authMode: "privy" });
      await db.insert(sessions).values({ id: "expiring", userId: "demo", channel: "voice", expiresAt: new Date(Date.now() + 1000).toISOString() });
      const response = await app.request("/events?sessionId=expiring");
      expect(response.status).toBe(200);
      reader = response.body!.getReader();
      const next = reader.read();
      if (trigger === "island") {
        vi.setSystemTime(new Date(Date.now() + 2000));
        await events.append(db, "expiring", { kind: "receive", address: "private-address", chain: "Arc_Testnet", tokens: [] });
      } else {
        await vi.advanceTimersByTimeAsync(15_000);
      }
      expect((await next).done).toBe(true);
    } finally {
      await reader?.cancel();
      vi.useRealTimers();
    }
  });
});
