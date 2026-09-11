// Which port the app serves on. Plain JavaScript and no app imports: both
// starters run it before anything is built — `thursday` (bin/thursday.mjs) and
// `pnpm dev` (scripts/dev.mts).

import { createServer } from "node:net";

/** The port when none is asked for. */
const DEFAULT_PORT = 3000;
/** How far past it to look before giving up. */
const SEARCH = 20;

/**
 * Every address a holder of the port may have bound. No single probe sees them
 * all: on macOS a socket on 127.0.0.1 does not block `::`, and one on `::` does
 * not block 127.0.0.1 — yet `localhost` reaches whichever answers first, so two
 * servers "on 3000" each serve some of the page. Probed one at a time, since
 * `0.0.0.0` and `::` block each other.
 */
const ADDRESSES = ["127.0.0.1", "::1", "0.0.0.0", "::"];

/** No IPv6 on this machine: nobody can hold that address either. */
const UNBINDABLE = new Set(["EADDRNOTAVAIL", "EAFNOSUPPORT"]);

const heldAt = (port, host) =>
  new Promise((resolve) => {
    const probe = createServer()
      .once("error", (cause) => resolve(!UNBINDABLE.has(cause.code)))
      .once("listening", () => probe.close(() => resolve(false)));
    probe.listen(port, host);
  });

/** Whether something already holds the port, on any address. */
async function taken(port) {
  for (const host of ADDRESSES) {
    if (await heldAt(port, host)) return true;
  }
  return false;
}

/**
 * 3000 is the most occupied port on a developer's machine. A port nobody asked
 * for is ours to move; a port that was asked for (`--port`, `PORT`) is not, and
 * saying so is more use than moving it quietly. Exits with the reason when no
 * port will do.
 */
export async function freePort(asked) {
  const wanted = asked?.trim() || undefined;
  const from = Number(wanted ?? DEFAULT_PORT);
  if (!Number.isInteger(from) || from < 1 || from > 65535) {
    console.error(`\n  Not a port: ${wanted}\n`);
    process.exit(1);
  }
  if (!(await taken(from))) return from;
  if (wanted !== undefined) {
    console.error(
      `\n  Port ${from} is already in use.\n  Try another: --port ${from + 1}\n`,
    );
    process.exit(1);
  }
  for (let port = from + 1; port < from + SEARCH; port++) {
    if (!(await taken(port))) return port;
  }
  console.error(`\n  Nothing free between ${from} and ${from + SEARCH}.\n`);
  process.exit(1);
}
