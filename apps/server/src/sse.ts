import type { SseEvent } from "@rot/contracts";
import type { NewEvent } from "./world.ts";

type Listener = (ev: SseEvent) => void;

/** Event hub: assigns ids, keeps a ring buffer for Last-Event-ID resume (spec 8). */
export class SseHub {
  private id = 0;
  private buffer: SseEvent[] = [];
  private listeners = new Set<Listener>();
  constructor(private readonly capacity = 2000) {}

  get lastId(): number {
    return this.id;
  }

  publish(ev: NewEvent): SseEvent {
    const full = { ...ev, id: ++this.id } as SseEvent;
    this.buffer.push(full);
    if (this.buffer.length > this.capacity) this.buffer.shift();
    for (const l of this.listeners) l(full);
    return full;
  }

  subscribe(l: Listener): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  /** Events after `lastId` if the buffer still holds them all, else undefined (send a snapshot instead). */
  since(lastId: number): SseEvent[] | undefined {
    if (lastId === this.id) return [];
    const first = this.buffer[0];
    if (!first || first.id > lastId + 1) return undefined;
    return this.buffer.filter((e) => e.id > lastId);
  }
}
