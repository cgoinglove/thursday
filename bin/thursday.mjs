#!/usr/bin/env node
// `npx thursday-agent` — the whole install story. Points the app's two roots at
// the build and at the user's home (config.ts APP_DIR / DATA_DIR), then boots
// the standalone server. Plain JavaScript: this runs before anything is built.

// First, so an older Node is told what it needs before anything else is evaluated
import "./node-check.mjs";
import { spawn } from "node:child_process";
import {
  existsSync,
  lstatSync,
  readlinkSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { backgroundJob, offerBackground } from "./background.mjs";
import { askToSetDatabaseAside, MIGRATION_FAILED_EXIT } from "./database.mjs";
import { holdFolder, runningOn, stopLines } from "./lock.mjs";
import { freePort } from "./port.mjs";
import { openBrowser, ROOT, thursdayCommand, toolPath } from "./tools.mjs";

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
  const command = thursdayCommand();
  console.log(`
  ${name} ${version}

  Usage
    $ ${command} [options]          Start it here, in this terminal
    $ ${command} start [options]    Keep it running in the background, and start it
                                    when you log in (macOS)
    $ ${command} stop               Stop it in the background
    $ ${command} status             Whether it runs, where, and how to reach it

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

// The background (background.mjs): each is the whole command, and never goes on to serve.
// `autostart` and `autostart --off` are what earlier versions called start and stop.
const background = { start: "start", stop: "stop", status: "status" }[
  argv[0] === "autostart" ? (has("--off") ? "stop" : "start") : argv[0]
];
if (background) {
  const { printStatus, startInBackground, stopBackground } = await import(
    "./background.mjs"
  );
  if (background === "status") printStatus({ home });
  else if (background === "stop") await stopBackground({ home });
  else {
    const started = await startInBackground({
      root: ROOT,
      home,
      port: asked,
      open: !has("--no-open"),
      version,
    });
    process.exit(started ? 0 : 1);
  }
  process.exit(0);
}

// Before a port is picked: a second server on this folder would take the next one, and
// serve the same calls, jobs and phone twice (lock.mjs). Run again, it is usually the app
// they came for — a second `npx` once its tab is closed — so that one opens instead. One of
// another version does not: they ran this one to have this one.
const running = runningOn(home);
if (running) {
  const other =
    running.version && running.version !== version ? running.version : null;
  const opens = Boolean(running.url) && !other && !has("--no-open");
  // The copy in the background moves to this version by starting it from this one
  const moves =
    other && backgroundJob()?.home === home
      ? `  To move it to ${version}: npx thursday-agent@${version} start\n`
      : null;
  console.log(
    `\n  Thursday${other ? ` ${other}` : ""} is already running on this data folder${running.url ? `: ${running.url}` : ""}\n${
      opens
        ? "  Opened it in your browser.\n"
        : (moves ??
          (other
            ? `  To run ${version} instead, stop that one and run this again.\n`
            : ""))
    }${
      moves
        ? ""
        : stopLines(running.pid, home)
            .map((line) => `  ${line}\n`)
            .join("")
    }`,
  );
  if (opens) openBrowser(running.url);
  process.exit(other ? 1 : 0);
}

// A first run in a terminal asks once whether to keep it running in the background; said
// yes, the background serves and this run is done
if (
  await offerBackground({
    root: ROOT,
    home,
    port: asked,
    open: !has("--no-open"),
    version,
  })
)
  process.exit(0);
const port = String(await freePort(asked, home));
const url = `http://localhost:${port}`;
holdFolder(home, url, version);
/** Where config.ts DB_PATH puts the database under the home. */
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
    // Only a link to this build is left alone. The tracer copies whatever a
    // route reads at runtime, so `public` arrives as a real folder holding a
    // few of its files: taking that for a link serves those and 404s the rest
    // — the icon, the call's sounds, the voice samples.
    const there = lstatSync(to, { throwIfNoEntry: false });
    if (there?.isSymbolicLink() && readlinkSync(to) === from) continue;
    if (there) rmSync(to, { recursive: true, force: true });
    symlinkSync(from, to, "junction");
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
      // How it was started and what the person types to run it, for Settings to say where it
      // runs and how to stop or keep it (features/settings/running.ts)
      THURSDAY_RUNS: process.env.THURSDAY_BACKGROUND
        ? "background"
        : process.stdin.isTTY
          ? "terminal"
          : "elsewhere",
      THURSDAY_COMMAND: thursdayCommand(),
      PORT: port,
      // This machine only. A voice agent with a shell is not a thing to expose.
      // Never inherited: Docker exports HOSTNAME as the container and some
      // distributions as the machine's name, and server.js binds to it.
      HOSTNAME: "127.0.0.1",
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
  // After the port is listening, and only on a server still up: one that could
  // not migrate is asking in the terminal
  setTimeout(() => {
    if (opened || server.exitCode !== null) return;
    opened = true;
    openBrowser(url);
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
// A terminal closed under it is a stop too (SIGHUP), and the server parks its work for it
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
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
