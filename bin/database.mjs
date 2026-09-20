// What both starters do when the server exits because it could not migrate the
// database. Plain JavaScript and no app imports: `thursday` (bin/thursday.mjs)
// and `pnpm dev` (scripts/dev.mts) load it before anything is built.

import { renameSync } from "node:fs";
import { createInterface } from "node:readline/promises";

/**
 * How boot exits when migrating fails (instrumentation-node.ts), so a starter
 * can tell it from any other crash. Not 77: `next dev` restarts on that.
 */
export const MIGRATION_FAILED_EXIT = 65;

/**
 * Asks to set aside the database the server could not migrate. The server has
 * already printed why and exited, so nothing holds the file. True once it is out
 * of the way and the server can start again on an empty one. With no terminal
 * there is nobody to ask, and the server's message already names the files.
 *
 * Moved rather than deleted: a database that will not migrate is as likely to be
 * a file damaged by a crash or a full disk as an old schema, and it is the only
 * copy of the keys, bots, calls and memory. A rename inside the same folder
 * cannot half-finish, so there is no moment where neither copy is whole.
 */
export async function askToSetDatabaseAside(dbPath) {
  if (!process.stdin.isTTY) return false;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  // Raw mode: Ctrl+C arrives here as a key, not as a signal
  rl.on("SIGINT", () => {
    console.log();
    process.exit(130);
  });
  const answer = await rl.question("  Set it aside and start over? [y/N] ");
  rl.close();
  if (!/^y/i.test(answer.trim())) return false;
  const aside = `${dbPath}.corrupt-${Date.now()}`;
  // WAL mode keeps two sidecars next to the file; each goes with it.
  for (const suffix of ["", "-wal", "-shm"]) {
    try {
      renameSync(`${dbPath}${suffix}`, `${aside}${suffix}`);
    } catch {
      // A sidecar SQLite had not written, or the main file is already gone
    }
  }
  console.log(`  Moved to ${aside}. Starting again.\n`);
  return true;
}
