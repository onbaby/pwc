import { Worker } from "node:worker_threads";
import { runTask, type TaskResult, type TaskSpec } from "./tasks.ts";

/** Run tasks on a worker pool (or inline when workers <= 1). Results come back in input order. */
export async function runTasks(tasks: TaskSpec[], workers: number, onProgress?: (done: number, total: number) => void): Promise<TaskResult[]> {
  const results = new Array<TaskResult>(tasks.length);
  if (workers <= 1) {
    tasks.forEach((t, i) => {
      results[i] = runTask(t);
      onProgress?.(i + 1, tasks.length);
    });
    return results;
  }
  let next = 0;
  let done = 0;
  await new Promise<void>((resolve, reject) => {
    const pool: Worker[] = [];
    const feed = (w: Worker, slot: { i: number }) => {
      if (next >= tasks.length) {
        void w.terminate();
        return;
      }
      slot.i = next++;
      w.postMessage(tasks[slot.i]);
    };
    for (let k = 0; k < workers; k++) {
      const w = new Worker(new URL("./worker.ts", import.meta.url));
      const slot = { i: -1 };
      w.on("message", (r: TaskResult) => {
        results[slot.i] = r;
        done++;
        onProgress?.(done, tasks.length);
        if (done === tasks.length) {
          pool.forEach((p) => void p.terminate());
          resolve();
        } else feed(w, slot);
      });
      w.on("error", reject);
      pool.push(w);
      feed(w, slot);
    }
  });
  return results;
}
