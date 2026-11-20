import { expect, it, vi } from "vitest";
import { watchIntent } from "./intent-status";

it("polls through an interrupted read and a pending submission, stops on the receipt, and never submits", async () => {
  vi.useFakeTimers();
  try {
    const get = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce({ status: "executing" })
      .mockResolvedValueOnce({ status: "succeeded", island: { kind: "receipt", intentId: "i" } });
    const observed = vi.fn();
    const stop = watchIntent(get, observed);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(observed.mock.calls.map(([r]) => r.status)).toEqual(["executing", "succeeded"]);
    expect(get).toHaveBeenCalledTimes(3);
    stop();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(get).toHaveBeenCalledTimes(3);
  } finally { vi.useRealTimers(); }
});

it("stops an outstanding read on teardown without applying its late result", async () => {
  let complete!: (result: { status: string }) => void;
  const read = vi.fn((_signal: AbortSignal) => new Promise<{ status: string }>((resolve) => { complete = resolve; }));
  const observed = vi.fn();
  const stop = watchIntent(read, observed);
  stop();
  complete({ status: "succeeded" });
  await Promise.resolve();
  expect(read.mock.calls[0]?.[0].aborted).toBe(true);
  expect(observed).not.toHaveBeenCalled();
});

it("stops reading an elapsed idle card and keeps reading an executing intent past card expiry", async () => {
  vi.useFakeTimers();
  try {
    const expired = { expiresAt: new Date(Date.now() - 1000).toISOString() };
    const idle = vi.fn().mockResolvedValue({ ...expired, status: "awaiting_confirmation" });
    const active = vi.fn().mockResolvedValueOnce({ ...expired, status: "executing" }).mockResolvedValue({ status: "succeeded" });
    const stopIdle = watchIntent(idle, vi.fn());
    const stopActive = watchIntent(active, vi.fn());
    await vi.advanceTimersByTimeAsync(15_000);
    stopIdle(); stopActive();
    expect(idle).toHaveBeenCalledTimes(1);
    expect(active).toHaveBeenCalledTimes(2);
  } finally { vi.useRealTimers(); }
});
