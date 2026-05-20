import type { AnomalyEvent } from "../schemas/anomaly.js";

export type AnomalyHandler = (event: AnomalyEvent) => void | Promise<void>;

const DEFAULT_RING_SIZE = 200;

/**
 * Phase 0 watcher: in-process pub/sub plus a bounded ring buffer of the most
 * recent events (default 200). Phase 3 connects to TheEights
 * observability.events.tail and Hydra telemetry JSONL.
 */
export class Watcher {
  private handlers: AnomalyHandler[] = [];
  private ring: AnomalyEvent[] = [];
  private ringSize: number;

  constructor(ringSize: number = DEFAULT_RING_SIZE) {
    this.ringSize = ringSize > 0 ? ringSize : DEFAULT_RING_SIZE;
  }

  subscribe(handler: AnomalyHandler): () => void {
    this.handlers.push(handler);
    return () => {
      const idx = this.handlers.indexOf(handler);
      if (idx >= 0) this.handlers.splice(idx, 1);
    };
  }

  async publish(event: AnomalyEvent): Promise<void> {
    this.ring.push(event);
    if (this.ring.length > this.ringSize) {
      this.ring.splice(0, this.ring.length - this.ringSize);
    }
    for (const h of this.handlers) {
      try {
        await h(event);
      } catch {
        // handler errors must not break the watcher
      }
    }
  }

  recent(limit?: number): AnomalyEvent[] {
    if (limit === undefined || limit <= 0 || limit >= this.ring.length) {
      return this.ring.slice();
    }
    return this.ring.slice(this.ring.length - limit);
  }
}
