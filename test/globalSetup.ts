import { copyFileSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "../src/server/db.ts";
import { seedDatabase } from "../src/server/seedDb.ts";
import { cachedSeed } from "../src/server/sandbox.ts";

/** Seed the sandbox once for the whole test run; each test file works on its own copy. */
let dir = "";
export default function setup() {
  dir = mkdtempSync(join(tmpdir(), "rot-test-"));
  const path = join(dir, "seed.db");
  const db = openDb(path);
  seedDatabase(db, cachedSeed());
  db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
  db.close();
  process.env.ROT_TEST_SEED_DB = path;
  return () => {
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  };
}
void copyFileSync;
