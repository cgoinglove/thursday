#!/usr/bin/env node
// `npx thursday-agent` — the whole install story. Points the app's two roots at
// the build and at the user's home (config.ts APP_DIR / DATA_DIR), then boots
// the standalone server. Plain JavaScript: this runs before anything is built.

import { spawn } from "node:child_process";
import { existsSync, symlinkSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createServer } from "node:net";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { ROOT, toolPath } from "./tools.mjs";

const { version, name } = JSON.parse(
  await readFile(join(ROOT, "package.json"), "utf8"),
);

/** The user's files: database, workspace, installed skills. Never inside the package — an upgrade replaces that. */
const DEFAULT_HOME = join(homedir(), ".thursday");

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

  Options
    --port <n>     Port to serve on (default 3000)
    --home <dir>   Where your data lives (default ~/.thursday)
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

/** Whether something already holds the port we are about to bind. */
const taken = (port) =>
  new Promise((resolve) => {
    const probe = createServer()
      .once("error", () => resolve(true))
      .once("listening", () => probe.close(() => resolve(false)))
      .listen(port, "127.0.0.1");
  });

/**
 * 3000 is the most occupied port on a developer's machine, and the first thing
 * `npx thursday-agent` does is bind it — so an untouched install used to end in
 * an EADDRINUSE stack trace. A port nobody asked for is ours to move; a port
 * that was asked for is not, and saying so is more use than moving it quietly.
 */
async function freePort(asked) {
  const from = Number(asked ?? 3000);
  if (!(await taken(from))) return from;
  if (asked !== undefined) {
    console.error(
      `\n  Port ${from} is already in use.\n  Try another: thursday --port ${from + 1}\n`,
    );
    process.exit(1);
  }
  for (let port = from + 1; port < from + 20; port++) {
    if (!(await taken(port))) return port;
  }
  console.error(`\n  Nothing free between ${from} and ${from + 20}.\n`);
  process.exit(1);
}

const asked = flag("port") ?? process.env.PORT;
const port = String(await freePort(asked));
const home = resolve(flag("home") || process.env.THURSDAY_HOME || DEFAULT_HOME);
const url = `http://localhost:${port}`;

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

const child = spawn(process.execPath, [join(APP, "server.js")], {
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
  },
});

if (!has("--no-open")) {
  const open =
    process.platform === "darwin"
      ? ["open", [url]]
      : process.platform === "win32"
        ? ["cmd", ["/c", "start", "", url]]
        : ["xdg-open", [url]];
  // After the port is listening; a browser that will not open is not a failure
  setTimeout(
    () => spawn(open[0], open[1], { stdio: "ignore" }).on("error", () => {}),
    1500,
  ).unref();
}

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
child.on("exit", (code) => process.exit(code ?? 0));
