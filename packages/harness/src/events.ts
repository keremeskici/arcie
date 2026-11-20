import type { ArcieError, IslandPayload, StepsIsland } from "@arcie/core";
import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import type { HarnessCtx } from "./context.js";

/** Per-session island fan-out; the SSE route subscribes, the harness publishes. */
export class EventBus {
  private readonly emitter = new EventEmitter().setMaxListeners(0);

  publish(sessionId: string, island: IslandPayload): void {
    this.emitter.emit(sessionId, island);
  }

  subscribe(sessionId: string, fn: (island: IslandPayload) => void): () => void {
    this.emitter.on(sessionId, fn);
    return () => this.emitter.off(sessionId, fn);
  }
}

/** Live, readable step list for one run; failed steps stay visible with their spoken error. */
export class StepTracker {
  private readonly steps: StepsIsland["steps"] = [];
  private readonly startedAt: number;

  constructor(
    private readonly bus: EventBus,
    private readonly ctx: HarnessCtx,
  ) {
    this.startedAt = ctx.now().getTime();
  }

  start(label: string): string {
    const id = randomUUID();
    this.steps.push({ id, label, status: "running" });
    this.emit();
    return id;
  }

  done(id: string): void {
    this.update(id, { status: "done" });
  }

  fail(id: string, err: ArcieError): void {
    this.update(id, { status: "failed", error: err.spoken });
  }

  private update(id: string, patch: Partial<StepsIsland["steps"][number]>): void {
    const s = this.steps.find((x) => x.id === id);
    if (s) Object.assign(s, patch);
    this.emit();
  }

  private emit(): void {
    this.bus.publish(this.ctx.sessionId, {
      kind: "steps",
      runId: this.ctx.runId,
      steps: this.steps.map((s) => ({ ...s })),
      elapsedMs: this.ctx.now().getTime() - this.startedAt,
    });
  }
}
