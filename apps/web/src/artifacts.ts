import type { BacktestArtifact, ExhibitsArtifact, LedgerEntry, PhiResult, PolicyResult, SimGridArtifact } from "@rot/contracts";
import { useJson } from "./api.ts";

export interface Artifacts {
  grid: SimGridArtifact;
  backtest: BacktestArtifact;
  exhibits: ExhibitsArtifact;
  ledger: LedgerEntry[];
}

export function useArtifacts(): Artifacts | undefined {
  const grid = useJson<SimGridArtifact>("/api/artifacts/sim_grid.json");
  const backtest = useJson<BacktestArtifact>("/api/artifacts/backtest.json");
  const exhibits = useJson<ExhibitsArtifact>("/api/artifacts/exhibits.json");
  const ledger = useJson<LedgerEntry[]>("/api/artifacts/ledger.json");
  if (!grid || !backtest || !exhibits || !ledger) return undefined;
  return { grid, backtest, exhibits, ledger };
}

/** Linear interpolation of a numeric field across the phi grid (slider 0-100 -> phi 0-1). */
export function interpolate(results: PhiResult[], phi: number, pick: (r: PhiResult) => number): number {
  const xs = results.map((r) => r.phi);
  if (phi <= xs[0]!) return pick(results[0]!);
  for (let i = 1; i < xs.length; i++) {
    if (phi <= xs[i]!) {
      const t = (phi - xs[i - 1]!) / (xs[i]! - xs[i - 1]!);
      return pick(results[i - 1]!) * (1 - t) + pick(results[i]!) * t;
    }
  }
  return pick(results[results.length - 1]!);
}

/** Smallest phi (0-1) at which `gain` reaches `need`, by linear interpolation; undefined if never. */
export function crossing(results: PhiResult[], gain: (r: PhiResult) => number): number | undefined {
  for (let i = 0; i < results.length; i++) {
    const g = gain(results[i]!);
    if (g >= 0) {
      if (i === 0) return results[0]!.phi;
      const prev = gain(results[i - 1]!);
      const t = -prev / (g - prev);
      return results[i - 1]!.phi + t * (results[i]!.phi - results[i - 1]!.phi);
    }
  }
  return undefined;
}

export function defaultPaced(grid: SimGridArtifact): PolicyResult {
  const d = grid.meta.defaultCell;
  return grid.cells.find((c) => c.key.replyBase === d.replyBase && c.key.replyAccuracySd === d.replyAccuracySd && c.key.cautiousness === d.cautiousness)!.paced;
}
