import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { BacktestArtifactSchema, ExhibitsArtifactSchema, LedgerEntrySchema, PriorsArtifactSchema, ScenarioSchema, SimGridArtifactSchema } from "../src/index.ts";

const dir = resolve(import.meta.dirname, "../../../artifacts");
const read = (n: string) => JSON.parse(readFileSync(resolve(dir, n), "utf8"));

describe("every committed artifact validates against its zod schema", () => {
  it("exhibits.json", () => void ExhibitsArtifactSchema.parse(read("exhibits.json")));
  it("priors.json", () => void PriorsArtifactSchema.parse(read("priors.json")));
  it("sim_grid.json", () => void SimGridArtifactSchema.parse(read("sim_grid.json")));
  it("backtest.json", () => void BacktestArtifactSchema.parse(read("backtest.json")));
  it("ledger.json", () => void (read("ledger.json") as unknown[]).forEach((e) => LedgerEntrySchema.parse(e)));
  it("has no unexpected artifact files", () => {
    expect(readdirSync(dir).sort()).toEqual(["backtest.json", "exhibits.json", "ledger.json", "priors.json", "sim_grid.json"]);
  });
});

describe("scenario file", () => {
  it("validates and has every persona the steps use", async () => {
    const { SCENARIO } = await import("../../../apps/server/src/scenario/scenario.ts");
    const s = ScenarioSchema.parse(SCENARIO);
    expect(s.personas.map((p) => p.id).sort()).toEqual(["dev", "jo", "maya", "priya", "sam"]);
    expect(s.stepOrder).toHaveLength(15);
  });
});
