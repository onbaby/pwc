import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  root: resolve(import.meta.dirname, "src/web"),
  publicDir: resolve(import.meta.dirname, "public"),
  plugins: [react(), tailwindcss()],
  server: { port: 5173, proxy: { "/api": "http://localhost:8787" } },
  build: { outDir: resolve(import.meta.dirname, "dist"), emptyOutDir: true, chunkSizeWarningLimit: 1200 },
  test: { root: import.meta.dirname, include: ["test/**/*.test.ts"], testTimeout: 180_000, hookTimeout: 180_000 },
});
