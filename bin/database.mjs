// What both starters do when the server exits because it could not migrate the
// database. Plain JavaScript and no app imports: `thursday` (bin/thursday.mjs)
// and `pnpm dev` (scripts/dev.mts) load it before anything is built.

import { rmSync } from "node:fs";
import { createInterface } from "node:readline/promises";

/**
 * How boot exits when migrating fails (instrumentation-node.ts), so a starter
 * can tell it from any other crash. Not 77: `next dev` restarts on that.
 */
export const MIGRATION_FAILED_EXIT = 65;

/**
 * Asks to remove the database the server could not migrate. The server has
 * already printed why and exited, so nothing holds the file. True once it is
 * gone and the server can start again on an empty one. With no terminal there
 * is nobody to ask, and the server's message already names the files.
 */
export async function askToRemoveDatabase(dbPath) {
  if (!process.stdin.isTTY) return false;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  // Raw mode: Ctrl+C arrives here as a key, not as a signal
  rl.on("SIGINT", () => {
    console.log();
    process.exit(130);
  });
  const answer = await rl.question("  Remove it and start over? [y/N] ");
  rl.close();
  if (!/^y/i.test(answer.trim())) return false;
  // WAL mode keeps two sidecars next to the file.
  for (const file of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) {
    rmSync(file, { force: true });
  }
  console.log("  Removed. Starting again.\n");
  return true;
}
