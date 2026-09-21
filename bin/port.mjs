// Which port the app serves on. Plain JavaScript and no app imports: both
// starters run it before anything is built — `thursday` (bin/thursday.mjs) and
// `pnpm dev` (scripts/dev.mts).

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { join } from "node:path";

/**
 * The port when none is asked for, and so the address a first run makes home. Not 3000,
 * the most occupied port on a developer's machine: the browser keeps the installed app,
 * her settings and the microphone permission per address, so home is best a port nothing
 * else comes to want later.
 */
const DEFAULT_PORT = 4747;
/** How far past it to look before giving up. */
const SEARCH = 20;

/**
 * Every address a holder of the port may have bound. No single probe sees them
 * all: on macOS a socket on 127.0.0.1 does not block `::`, and one on `::` does
 * not block 127.0.0.1 — yet `localhost` reaches whichever answers first, so two
 * servers "on one port" each serve some of the page. Probed one at a time, since
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
export async function portTaken(port) {
  for (const host of ADDRESSES) {
    if (await heldAt(port, host)) return true;
  }
  return false;
}

/**
 * The port this data folder was last served on. A browser keeps what it knows of the
 * app — her face, the call settings, the microphone permission — per address, port
 * included, so coming back on another port looks like a first visit. The port of the
 * first run is the one tried first from then on, and a day spent on another is said out
 * loud rather than made quietly.
 */
// Named as private files are here, so a checkout never commits it
const PORT_FILE = "port.local.txt";
const lastPort = (home) => {
  try {
    const port = Number(readFileSync(join(home, PORT_FILE), "utf8").trim());
    return Number.isInteger(port) && port > 0 && port < 65536 ? port : null;
  } catch {
    return null;
  }
};
const keepPort = (home, port) => {
  try {
    mkdirSync(home, { recursive: true });
    writeFileSync(join(home, PORT_FILE), `${port}\n`);
  } catch {
    // A folder that cannot be written only costs the memory of the port
  }
};

/** The address this data folder is expected on: the port it kept, else the default. */
export const homePort = (home) => lastPort(home) ?? DEFAULT_PORT;

/**
 * A port nobody asked for is ours to move; a port that was asked for (`--port`,
 * `PORT`) is not, and saying so is more use than moving it quietly. Exits with
 * the reason when no port will do.
 */
export async function freePort(asked, home) {
  const port = await pickPort(asked, home);
  const last = home ? lastPort(home) : null;
  const chosen = Boolean(asked?.trim());
  if (last && last !== port && !chosen)
    console.warn(
      `\n  Port ${last}, where this app lives, is in use: serving on ${port} for now.\n  A browser keeps settings per address, so they are not the ones from ${last}.\n  To move here for good: --port ${port}\n`,
    );
  // The first run's port is home, and a day on another port is a detour that leaves home
  // where it was. Only a port asked for by name moves it: that is the user deciding
  if (home && (!last || chosen)) keepPort(home, port);
  return port;
}

async function pickPort(asked, home) {
  const wanted = asked?.trim() || undefined;
  const last = wanted === undefined && home ? lastPort(home) : null;
  if (last && !(await portTaken(last))) return last;
  const from = Number(wanted ?? DEFAULT_PORT);
  if (!Number.isInteger(from) || from < 1 || from > 65535) {
    console.error(`\n  Not a port: ${wanted}\n`);
    process.exit(1);
  }
  if (!(await portTaken(from))) return from;
  if (wanted !== undefined) {
    console.error(
      `\n  Port ${from} is already in use.\n  Try another: --port ${from + 1}\n`,
    );
    process.exit(1);
  }
  for (let port = from + 1; port < from + SEARCH; port++) {
    if (!(await portTaken(port))) return port;
  }
  console.error(`\n  Nothing free between ${from} and ${from + SEARCH}.\n`);
  process.exit(1);
}
