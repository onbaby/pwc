// pnpm dev: spawns the API server (tsx watch, :8787) and Vite (:5173, /api proxied to the server).
import { spawn } from "node:child_process";

const children = [
  spawn("pnpm", ["exec", "tsx", "watch", "src/server/index.ts"], { stdio: "inherit", env: { ...process.env, SANDBOX: process.env.SANDBOX ?? "1" } }),
  spawn("pnpm", ["exec", "vite"], { stdio: "inherit" }),
];
const stop = () => children.forEach((c) => c.kill());
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
children.forEach((c) => c.on("exit", (code) => { stop(); process.exit(code ?? 0); }));
