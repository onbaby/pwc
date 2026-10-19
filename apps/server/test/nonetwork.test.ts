import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../../..");

describe("demo start rules", () => {
  it("refuses to start without an explicit CHANNEL and says why", () => {
    const r = spawnSync("pnpm", ["exec", "tsx", "apps/server/src/main.ts"], { cwd: root, encoding: "utf8", env: { ...process.env, CHANNEL: "" } });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("Refusing to start without an explicit channel");
  });
  it("refuses CHANNEL=photon with NO_NETWORK=1", () => {
    const r = spawnSync("pnpm", ["exec", "tsx", "apps/server/src/main.ts"], { cwd: root, encoding: "utf8", env: { ...process.env, CHANNEL: "photon", NO_NETWORK: "1" } });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("cannot run with NO_NETWORK=1");
  });
});
