#!/usr/bin/env node
// `npx thursday-agent` — the whole install story. Points the app's two roots at
// the build and at the user's home (config.ts APP_DIR / DATA_DIR), then boots
// the standalone server. Plain JavaScript: this runs before anything is built.

import { spawn } from "node:child_process";
import { existsSync, symlinkSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { askToSetDatabaseAside, MIGRATION_FAILED_EXIT } from "./database.mjs";
import { freePort } from "./port.mjs";
import { ROOT, toolPath } from "./tools.mjs";

const { version, name } = JSON.parse(
  await readFile(join(ROOT, "package.json"), "utf8"),
);

const argv = process.argv.slice(2);
const has = (...names) => names.some((one) => argv.includes(one));
const flag = (name) => {
  const at = argv.indexOf(`--${name}`);
  const next = at < 0 ? undefined : argv[at + 1];
  return next && !next.startsWith("-") ? next : undefined;
};

if (has("-h", "--help")) {
  console.log(`
  ${name} ${version}

  Usage
    $ thursday [options]
    $ thursday autostart [--off]   Start with the computer, macOS only

  Options
    --port <n>     Port to serve on (default 4747, or the next free one)
    --home <dir>   Where your data lives (default ~/.thursday; a checkout uses itself)
    --no-open      Do not open a browser
    -v, --version  Print the version
    -h, --help     This

  Everything else — keys, models, bots — is set inside the app.
`);
  process.exit(0);
}

if (has("-v", "--version")) {
  console.log(version);
  process.exit(0);
}

/**
 * The published package is the standalone tree itself (scripts/pack); a
 * checkout keeps it where Next wrote it. Whichever holds `server.js` is what
 * APP_DIR means: the migrations and the shipped skills sit beside it.
 */
const APP = [ROOT, join(ROOT, ".next", "standalone")].find((dir) =>
  existsSync(join(dir, "server.js")),
);
if (!APP) {
  console.error(`\n  No build in ${ROOT}\n  In a checkout, run: pnpm build\n`);
  process.exit(1);
}

/**
 * The user's files: database, workspace, installed skills. An installed package
 * keeps them in the home folder, never inside the package — an upgrade replaces
 * that. A checkout keeps them in the checkout, which is where `pnpm dev` already
 * writes them (config.ts DATA_DIR): a build started here opens the data it was
 * developed against, not a second, empty one beside it.
 */
const DEFAULT_HOME = APP === ROOT ? join(homedir(), ".thursday") : ROOT;

const asked = flag("port") ?? process.env.PORT;
const home = resolve(flag("home") || process.env.THURSDAY_HOME || DEFAULT_HOME);

// Turning it on or off is the whole command; it never goes on to serve.
if (argv[0] === "autostart") {
  const { autostart } = await import("./autostart.mjs");
  await autostart({ root: ROOT, home, off: has("--off") });
  process.exit(0);
}

const port = String(await freePort(asked, home));
const url = `http://localhost:${port}`;
/** Where config.ts DB_FILE_NAME puts the database under the home. */
const database = join(home, "local.db");

/**
 * Next leaves `.next/static` and `public` out of the standalone tree on purpose
 * — a deployment usually puts them on a CDN. The published package has them
 * copied in beside the server (scripts/pack); a checkout does not, so every
 * asset would 404. Link them instead of branching on where we are: `pnpm start`
 * then runs the same server, the same way, as `npx`.
 */
if (APP !== ROOT) {
  for (const [from, to] of [
    [join(ROOT, ".next", "static"), join(APP, ".next", "static")],
    [join(ROOT, "public"), join(APP, "public")],
  ]) {
    if (!existsSync(from)) continue;
    // Already there — linked by an earlier run, or copied in by hand.
    try {
      symlinkSync(from, to, "junction");
    } catch (cause) {
      if (cause.code !== "EEXIST") throw cause;
    }
  }
}

console.log(`\n  ${name} ${version}\n  ${url}\n  data: ${home}\n`);

let child;
let opened = has("--no-open");

/** The server. Started again once a database it could not migrate is removed. */
function start() {
  const server = spawn(process.execPath, [join(APP, "server.js")], {
    stdio: "inherit",
    env: {
      ...process.env,
      // Set explicitly: the standalone server chdirs into its own folder, so
      // neither root may be left to the cwd (config.ts)
      THURSDAY_APP_DIR: APP,
      THURSDAY_HOME: home,
      THURSDAY_URL: url,
      // Where a bot's shell finds playwright-cli (workspace.ts TOOL_PATH)
      THURSDAY_TOOL_PATH: toolPath().join(":"),
      PORT: port,
      // This machine only. A voice agent with a shell is not a thing to expose.
      HOSTNAME: process.env.HOSTNAME || "127.0.0.1",
      NODE_ENV: "production",
      // The server parks running jobs on a stop before it exits (instrumentation);
      // without this, Next exits on the signal first
      NEXT_MANUAL_SIG_HANDLE: "true",
    },
  });
  child = server;
  server.on("exit", async (code) => {
    if (
      code === MIGRATION_FAILED_EXIT &&
      (await askToSetDatabaseAside(database))
    )
      return start();
    process.exit(code ?? 0);
  });

  if (opened) return;
  const open =
    process.platform === "darwin"
      ? ["open", [url]]
      : process.platform === "win32"
        ? ["cmd", ["/c", "start", "", url]]
        : ["xdg-open", [url]];
  // After the port is listening, and only on a server still up: one that could
  // not migrate is asking in the terminal. A browser that will not open is not a failure
  setTimeout(() => {
    if (opened || server.exitCode !== null) return;
    opened = true;
    spawn(open[0], open[1], { stdio: "ignore" }).on("error", () => {});
  }, 1500).unref();
}
start();

/**
 * Ctrl+C reaches the whole process group, so the server normally hears it first
 * and closes on its own. When it does not, it is holding a connection that does
 * not end — the browser's event stream is one — and a second Ctrl+C is not a
 * request to try again.
 */
let stopping = false;
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    if (stopping) {
      child.kill("SIGKILL");
      return;
    }
    stopping = true;
    child.kill(signal);
    setTimeout(() => child.kill("SIGKILL"), 4000).unref();
  });
}
