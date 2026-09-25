// One server to a data folder. A second one started on the same folder took the next port
// and, at its boot, parked the first one's running jobs, closed its open calls and joined
// the phone a second time, so every message was answered twice. The second is refused, and
// told where the first one is.

import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** Beside the database, and named so a checkout never commits it (`*.local.*`). */
const LOCK_FILE = "server.local.lock";

/** The server already serving this data folder: where it is. Null when none is alive. */
export function runningOn(home) {
  let held;
  try {
    held = JSON.parse(readFileSync(join(home, LOCK_FILE), "utf8"));
  } catch {
    return null;
  }
  if (!Number.isInteger(held?.pid) || held.pid === process.pid) return null;
  try {
    // Signal 0 asks whether the process exists and sends nothing
    process.kill(held.pid, 0);
  } catch (error) {
    // Someone else's process by that id is still a live one
    if (error?.code !== "EPERM") return null;
  }
  return { pid: held.pid, url: String(held.url ?? "") };
}

/** Exits with where the running one is, when this folder already has a server. */
export function refuseSecond(home) {
  const running = runningOn(home);
  if (!running) return;
  console.error(
    `\n  Thursday is already running on this data folder${running.url ? `: ${running.url}` : ""}\n  Open that one, or stop it first (Ctrl+C where it runs; one that starts with the\n  computer stops with: thursday autostart --off).\n`,
  );
  process.exit(1);
}

/** Marks this folder as served from here until this process ends. */
export function holdFolder(home, url) {
  const file = join(home, LOCK_FILE);
  try {
    mkdirSync(home, { recursive: true });
    writeFileSync(file, `${JSON.stringify({ pid: process.pid, url })}\n`);
  } catch {
    // A folder that cannot be written is not a reason not to serve
    return;
  }
  process.on("exit", () => {
    try {
      if (JSON.parse(readFileSync(file, "utf8")).pid === process.pid)
        rmSync(file, { force: true });
    } catch {
      // Gone already
    }
  });
}
