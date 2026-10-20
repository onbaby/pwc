import type { ConsoleEvent } from "./flows/context.ts";

type Listener = (ev: ConsoleEvent & { id: number }) => void;

/** Event hub for the SSE stream (spec 12.4): message, projection, queue, offer, clock (+ toast). */
export class Hub {
  private id = 0;
  private listeners = new Set<Listener>();
  get lastId(): number {
    return this.id;
  }
  publish(e: ConsoleEvent): void {
    const ev = { ...e, id: ++this.id };
    for (const l of this.listeners) l(ev);
  }
  subscribe(l: Listener): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }
}
