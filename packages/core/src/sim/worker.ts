import { parentPort } from "node:worker_threads";
import { runTask, type TaskSpec } from "./tasks.ts";

parentPort!.on("message", (spec: TaskSpec) => {
  parentPort!.postMessage(runTask(spec));
});
