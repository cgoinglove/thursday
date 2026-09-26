// Running in the background: macOS's launchd starts the server when the person logs in, starts
// it again if it stops, and no terminal is needed. `start`, `stop` and `status`, and the one
// question a first run in a terminal asks. Plain JavaScript and no app imports, like the rest
// of bin: it runs from the published package.

import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join, sep } from "node:path";
import { createInterface } from "node:readline/promises";
import { runningOn, stopLines } from "./lock.mjs";
import { homePort, portTaken } from "./port.mjs";
import { isCheckout, openBrowser, PROGRAM, thursdayCommand } from "./tools.mjs";

/** launchd's name for the job. The file it reads is named after it. */
const LABEL = "thursday-agent";

/** Named as private files are here, so a checkout never commits its own log. */
const LOG_FILE = "server.local.log";

/**
 * Written when the person has decided about the background — answered no, or stopped it — so a
 * run in a terminal does not ask again.
 */
const DECIDED_FILE = "background.local.txt";

/** How long the port gets to come free after the job holding it is stopped. */
const FREE_MS = 10_000;

/** How long a job just started gets to answer: a first boot migrates the database. */
const UP_MS = 90_000;

const AGENTS = join(homedir(), "Library", "LaunchAgents");
const PLIST = join(AGENTS, `${LABEL}.plist`);

/** This login session. A user agent, so it goes with the person, not the machine. */
const domain = () => `gui/${process.getuid()}`;

const launchctl = (...args) =>
  spawnSync("launchctl", args, { encoding: "utf8" });

/** A path holding `&` or `<` would end the document early. */
const xml = (text) =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const unxml = (text) =>
  text.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

const mac = () => process.platform === "darwin";

/**
 * What the job is set to run, read back from its file: the data folder and the port. Null when
 * there is no job, or on another system. One job per login: it serves one data folder.
 */
export function backgroundJob() {
  if (!mac()) return null;
  let plist;
  try {
    plist = readFileSync(PLIST, "utf8");
  } catch {
    return null;
  }
  const value = (name) =>
    plist.match(
      new RegExp(`<string>--${name}</string>\\s*<string>([^<]*)</string>`),
    )?.[1];
  const home = value("home");
  if (!home) return null;
  return { home: unxml(home), port: Number(value("port")) || null };
}

/**
 * The job as launchd has it: the pid of the running starter, and how it last exited. Null when
 * launchd has no such job loaded.
 */
function jobState() {
  const printed = launchctl("print", `${domain()}/${LABEL}`);
  if (printed.status !== 0) return null;
  return {
    pid: Number(printed.stdout.match(/^\s*pid = (\d+)/m)?.[1]) || null,
    exit:
      printed.stdout.match(/^\s*last exit code = (.+)$/m)?.[1]?.trim() ?? null,
  };
}

const plistOf = ({
  cli,
  home,
  port,
  log,
}) => `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LABEL}</string>
  <!-- The home and the port are written in rather than left to be found: launchd starts a
       job in no folder of its own, and a server that quietly moved to another port would
       leave the installed window looking at an address nothing answers on. -->
  <key>ProgramArguments</key>
  <array>
    <!-- Node by name on the PATH below, not by the file it was: a Homebrew or version
         manager upgrade removes that file, and the app stopped starting at login -->
    <string>/usr/bin/env</string>
    <string>node</string>
    <string>${xml(cli)}</string>
    <string>--home</string>
    <string>${xml(home)}</string>
    <string>--port</string>
    <string>${port}</string>
    <string>--no-open</string>
  </array>
  <!-- launchd hands a job a PATH with none of what a person installs, and every shell a bot
       runs inherits the server's (features/workspace). This is the PATH of the terminal that
       started it. -->
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>${xml(process.env.PATH ?? "")}</string>
    <!-- How the starter knows it is this job, and tells Settings where it runs -->
    <key>THURSDAY_BACKGROUND</key>
    <string>1</string>
    <!-- What the person typed to start it, for every line that tells them what to type next:
         the copy that runs here cannot tell npx from a global install -->
    <key>THURSDAY_COMMAND</key>
    <string>${xml(thursdayCommand())}</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <!-- Started again whenever it stops, so a crash in the night is up by morning. A server
       that cannot open its database exits the same way; the wait keeps that to twice a
       minute, and the log says why each time. -->
  <key>KeepAlive</key>
  <true/>
  <key>ThrottleInterval</key>
  <integer>30</integer>
  <key>StandardOutPath</key>
  <string>${xml(log)}</string>
  <key>StandardErrorPath</key>
  <string>${xml(log)}</string>
</dict>
</plist>
`;

/** Whether the port is free, giving a server that was just stopped time to let go of it. */
async function waitFree(port) {
  for (let waited = 0; waited < FREE_MS; waited += 250) {
    if (!(await portTaken(port))) return true;
    await sleep(250);
  }
  return !(await portTaken(port));
}

const same = (a, b) => {
  try {
    return realpathSync(a) === realpathSync(b);
  } catch {
    return false;
  }
};

/** Whether a copy installed under PROGRAM is whole, and the version it says it is. */
function intact(installed, version) {
  try {
    const manifest = JSON.parse(
      readFileSync(join(installed, "package.json"), "utf8"),
    );
    return (
      manifest.version === version && existsSync(join(installed, "server.js"))
    );
  } catch {
    return false;
  }
}

/**
 * The copy the job runs. A checkout runs itself: its build is the point of it. Any other copy
 * is installed under PROGRAM, one folder per version, with npm and from the very files that are
 * running — `--install-links` packs a folder rather than linking it — so the job runs what was
 * just run, from npm's cache and without the network. npx's own copy lives in a cache npm
 * empties, and a login item that pointed there broke the day it did. A version of its own
 * leaves the copy that runs now untouched until the new one is up.
 */
function installCopy(root, version) {
  if (isCheckout(root)) return root;
  const folder = join(PROGRAM, version);
  const installed = join(folder, "node_modules", "thursday-agent");
  if (same(root, installed) || intact(installed, version)) return installed;
  // Half a copy from an install that was cut short
  rmSync(folder, { recursive: true, force: true });
  mkdirSync(folder, { recursive: true });
  writeFileSync(
    join(folder, "package.json"),
    `${JSON.stringify({ private: true })}\n`,
  );
  const npm = spawnSync(
    "npm",
    [
      "install",
      "--prefix",
      folder,
      "--install-links",
      "--prefer-offline",
      "--no-audit",
      "--no-fund",
      "--loglevel=error",
      root,
    ],
    { encoding: "utf8", stdio: ["ignore", "ignore", "pipe"] },
  );
  if (npm.error?.code === "ENOENT")
    throw new Error("npm was not found. It comes with Node.");
  if (npm.error || npm.status !== 0)
    throw new Error(
      npm.stderr?.trim() || npm.error?.message || `npm exited ${npm.status}`,
    );
  if (!intact(installed, version))
    throw new Error(`npm finished, but ${installed} is not a whole copy.`);
  return installed;
}

/** Every version installed under PROGRAM but the one the job now runs. */
function pruneCopies(program) {
  let names;
  try {
    names = readdirSync(PROGRAM);
  } catch {
    return;
  }
  for (const name of names) {
    const folder = join(PROGRAM, name);
    if (/^\d+\.\d+\.\d+/.test(name) && !program.startsWith(`${folder}${sep}`))
      rmSync(folder, { recursive: true, force: true });
  }
}

/**
 * Puts back the job there was before a start that did not work, so what ran still runs; with
 * none before, no job is left behind to fail again at every login.
 */
function restore(before) {
  if (before === null) {
    rmSync(PLIST, { force: true });
    return false;
  }
  writeFileSync(PLIST, before);
  return launchctl("bootstrap", domain(), PLIST).status === 0;
}

/** How far the log runs now, so a failure shows only what this start wrote after it. */
function logSize(log) {
  try {
    return statSync(log).size;
  } catch {
    return 0;
  }
}

/** The last lines the log gained since `from`, for a start that did not come up. */
function logTail(log, from, lines = 12) {
  try {
    return readFileSync(log)
      .subarray(from)
      .toString("utf8")
      .trimEnd()
      .split("\n")
      .slice(-lines);
  } catch {
    return [];
  }
}

/**
 * Whether the server answers a page. The port alone is not enough: Next listens first and
 * migrates the database after, and a server that cannot migrate held the port for a moment
 * before it exited — taken for a start that worked.
 */
async function answers(port) {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/`, {
      redirect: "manual",
      signal: AbortSignal.timeout(15_000),
    });
    return response.status < 500;
  } catch {
    return false;
  }
}

/**
 * Waits for the job to serve a page. A job that stopped with a failure meanwhile is not waited
 * on — launchd would start it again in half a minute, and it would fail the same way.
 */
async function waitUp(port) {
  const until = Date.now() + UP_MS;
  const since = Date.now();
  while (Date.now() < until) {
    if ((await portTaken(port)) && (await answers(port))) return true;
    const state = jobState();
    if (!state) return false;
    if (!state.pid && failed(state.exit) && Date.now() - since > 2000)
      return false;
    await sleep(500);
  }
  return false;
}

/** An exit launchd recorded that was a failure; "(never exited)" is a job not yet run. */
const failed = (exit) => {
  const code = Number.parseInt(exit ?? "", 10);
  return Number.isInteger(code) && code !== 0;
};

/** Remembers that the person decided, so a run in a terminal does not ask again. */
function markDecided(home) {
  try {
    mkdirSync(home, { recursive: true });
    writeFileSync(join(home, DECIDED_FILE), "no\n");
  } catch {
    // A folder that cannot be written only costs the question once more
  }
}

/** Lines to print, indented; null is a line left out, "" an empty one. */
const block = (lines) =>
  `\n${lines
    .filter((line) => line !== null)
    .map((line) => (line ? `  ${line}` : ""))
    .join("\n")}\n`;
const say = (lines) => console.log(block(lines));
const fail = (lines) => console.error(block(lines));

/**
 * Starts the server in the background and has it start when the person logs in; a job already
 * there — another version, another data folder, or one that stopped — is replaced, and put
 * back if the new one does not come up. True once it serves. Everything it could not do is
 * said before it returns false.
 */
export async function startInBackground({
  root,
  home,
  port: asked,
  open,
  version,
}) {
  const command = thursdayCommand();
  if (!mac()) {
    fail([
      "Running in the background is macOS only for now.",
      `Elsewhere, run ${command} in a terminal and leave it open,`,
      "or add it to the programs that start when you log in.",
    ]);
    return false;
  }

  const state = jobState();
  const job = backgroundJob();
  const running = runningOn(home);
  // A server on this folder that is not the job: two must never share one database, and
  // stopping a person's terminal for them is not this command's to do
  if (running && running.pid !== state?.pid) {
    fail([
      `Thursday is already running on this data folder${running.url ? `: ${running.url}` : ""}`,
      ...stopLines(running.pid, home),
      "Then run this again.",
    ]);
    return false;
  }
  if (running && job?.home === home && running.version === version) {
    say([
      `Thursday ${version} already runs in the background: ${running.url}`,
      open ? "Opened it in your browser." : null,
    ]);
    if (open && running.url) openBrowser(running.url);
    return true;
  }

  const port = Number(asked ?? homePort(home));
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    fail([`Not a port: ${asked}`]);
    return false;
  }
  // The job about to be replaced may hold it; anything else holding it is not about to move
  const busy = () =>
    fail([
      `Something else serves on port ${port}.`,
      "Stop it, or choose another with --port, and run this again.",
    ]);
  if (!(state?.pid && job?.port === port) && (await portTaken(port))) {
    busy();
    return false;
  }

  console.log("\n  Setting up the copy that runs in the background…");
  let program;
  try {
    program = installCopy(root, version);
  } catch (error) {
    fail([
      `Could not install it into ${PROGRAM}:`,
      ...String(error?.message ?? error)
        .split("\n")
        .slice(-6),
      "",
      "Nothing was changed. Your data is as it was.",
    ]);
    return false;
  }

  // Not loaded is not a failure: this is also how an earlier job lets go before a new one
  const before = existsSync(PLIST) ? readFileSync(PLIST, "utf8") : null;
  if (state) {
    launchctl("bootout", `${domain()}/${LABEL}`);
    if (job?.port) await waitFree(job.port);
  }
  if (!(await waitFree(port))) {
    restore(before);
    busy();
    return false;
  }

  const log = join(home, LOG_FILE);
  const from = logSize(log);
  mkdirSync(home, { recursive: true });
  mkdirSync(AGENTS, { recursive: true });
  writeFileSync(
    PLIST,
    plistOf({ cli: join(program, "bin", "thursday.mjs"), home, port, log }),
  );
  const started = launchctl("bootstrap", domain(), PLIST);
  if (started.status !== 0) {
    const back = restore(before);
    fail([
      "macOS refused to start it in the background:",
      started.stderr?.trim() || `launchctl exited ${started.status}`,
      back ? "The one that ran before is starting again." : null,
    ]);
    return false;
  }

  const url = `http://localhost:${port}`;
  if (!(await waitUp(port))) {
    // Taken back out: left in, launchd would start it every half minute and at every login,
    // failing the same way each time
    launchctl("bootout", `${domain()}/${LABEL}`);
    const back = restore(before);
    fail([
      "It did not come up in the background. The log says why:",
      "",
      ...logTail(log, from),
      "",
      `Log: ${log}`,
      back
        ? "The one that ran before is starting again."
        : "Nothing runs in the background now.",
      `Run in a terminal, ${command}, and it can ask what to do about it.`,
    ]);
    return false;
  }
  pruneCopies(program);

  say([
    `Thursday ${version} runs in the background, and starts when you log in.`,
    url,
    `data: ${home}`,
    // One job serves one folder: the one it served before is left, and said so
    job && job.home !== home
      ? `It no longer serves ${job.home}, which is kept as it is.`
      : null,
    open ? "Opened it in your browser. This terminal can be closed." : null,
    `To stop it: ${command} stop`,
  ]);
  if (open) openBrowser(url);
  return true;
}

/** Stops the background job, and it no longer starts at login. The data folder is untouched. */
export async function stopBackground({ home }) {
  const command = thursdayCommand();
  const job = backgroundJob();
  const state = mac() ? jobState() : null;
  const terminal = runningOn(home);

  if (!job && !state) {
    say([
      "Thursday was not running in the background.",
      ...(terminal ? stopLines(terminal.pid, home) : []),
    ]);
    return;
  }

  launchctl("bootout", `${domain()}/${LABEL}`);
  rmSync(PLIST, { force: true });
  if (job?.port) await waitFree(job.port);
  // Stopped on purpose: a later run in a terminal does not ask again
  markDecided(job?.home ?? home);
  say([
    "Thursday stopped, and no longer starts when you log in.",
    job ? `data: ${job.home} (kept as it is)` : null,
    `Start it again: ${command} start`,
  ]);
}

/** Where Thursday runs, if it does, and how to reach and stop it. */
export function printStatus({ home }) {
  const command = thursdayCommand();
  const job = backgroundJob();
  const state = mac() && job ? jobState() : null;
  const served = job ? runningOn(job.home) : null;

  if (job && served && served.pid === state?.pid) {
    say([
      `Thursday${served.version ? ` ${served.version}` : ""} runs in the background, and starts when you log in.`,
      served.url,
      `data: ${job.home}`,
      `log:  ${join(job.home, LOG_FILE)}`,
      `To stop it: ${command} stop`,
    ]);
    return;
  }
  if (job) {
    say([
      "Thursday is set to start when you log in, but is not running now.",
      failed(state?.exit)
        ? `It last stopped with exit ${state.exit}. The log says why:`
        : "The log says why:",
      join(job.home, LOG_FILE),
      `Try again: ${command} start   ·   Stop trying: ${command} stop`,
    ]);
    return;
  }
  const terminal = runningOn(home);
  if (terminal) {
    say([
      `Thursday runs on this data folder${terminal.url ? `: ${terminal.url}` : ""}, not in the background.`,
      ...stopLines(terminal.pid, home),
      mac()
        ? `To run it in the background instead, stop it and run: ${command} start`
        : null,
    ]);
    return;
  }
  say([
    "Thursday is not running.",
    mac() ? `In the background: ${command} start` : null,
    `In this terminal:  ${command}`,
  ]);
}

/**
 * The one question a first run asks: whether to keep Thursday running in the background.
 * Asked of a person at a terminal on a Mac, with no job yet and nothing decided before; a
 * checkout is someone working on the app, who runs it by hand. True once it runs in the
 * background, and this run has nothing left to do; false to serve here, in the terminal.
 */
export async function offerBackground({ root, home, port, open, version }) {
  if (!mac() || !process.stdin.isTTY || !process.stdout.isTTY) return false;
  if (process.env.CI || isCheckout(root)) return false;
  if (existsSync(PLIST) || existsSync(join(home, DECIDED_FILE))) return false;

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  // Raw mode: Ctrl+C arrives here as a key, not as a signal
  rl.on("SIGINT", () => {
    console.log();
    process.exit(130);
  });
  // Ctrl+D ends the input and rejects the question: an answer nobody gave is not a yes, and
  // not a decision to remember either — the next run asks again
  const answer = await rl
    .question(
      "\n  Keep Thursday running in the background, and start it when you log in? [Y/n] ",
    )
    .catch((error) => {
      if (error?.name === "AbortError") return null;
      throw error;
    });
  rl.close();

  if (answer === null) {
    console.log();
    return false;
  }
  if (/^n/i.test(answer.trim())) {
    markDecided(home);
    console.log(
      `\n  It runs in this terminal until you close it.\n  To keep it running in the background later: ${thursdayCommand()} start`,
    );
    return false;
  }
  if (await startInBackground({ root, home, port, open, version })) return true;
  console.log("  Running it in this terminal instead.");
  return false;
}
