import { resolve } from "node:path";
import { openDb } from "../server/db.ts";
import { databaseChecksum, seedDatabase } from "../server/seedDb.ts";

/** pnpm seed [--db data/console.db]: deterministic sample data. Never run while the server has the file open. */
const arg = (name: string): string | undefined => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const root = resolve(import.meta.dirname, "../..");
const path = resolve(root, arg("--db") ?? "data/console.db");
const db = openDb(path);
const report = seedDatabase(db);
console.log(`seeded ${path}`);
console.log(report);
console.log("checksum", databaseChecksum(db));
