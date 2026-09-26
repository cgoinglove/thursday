// Running in the background: macOS's launchd starts the server when the person logs in, starts
// it again if it stops, and no terminal is needed. `start`, `stop` and `status`, and the one
// question a first run in a terminal asks. Plain JavaScript and no app imports, like the rest
// of bin: it runs from the published package.

import { spawnSync } from "node:child_process";
import {
  closeSync,
  existsSync,
  fstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { delimiter, join, sep } from "node:path";
import { createInterface } from "node:readline/promises";
import { heldBy, runningOn, startedAt, stillRuns, stopLines } from "./lock.mjs";
import { homePort, portTaken } from "./port.mjs";
import {
  commandFor,
  isCheckout,
  openBrowser,
  PROGRAM,
  thursdayCommand,
} from "./tools.mjs";

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

/** Written into a copy's folder under PROGRAM once npm has put all of it there. */
const INSTALLED = "installed.json";

/**
 * One start at a time: two would install into one folder, and each replace the other's job. In
 * the temporary folder, which is this person's own on a Mac, so it holds nothing for long.
 */
const START_LOCK = join(tmpdir(), `${LABEL}-start.lock`);

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
  return {
    home: unxml(home),
    port: Number(value("port")) || null,
    // Written by `autostart` before there was a copy of its own to run: from a global install,
    // and without the mark that tells Settings it is the background
    legacy: !plist.includes("<key>THURSDAY_BACKGROUND</key>"),
  };
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
    <!-- Node by name on the PATH below, not by the file it was: a Homebrew upgrade removes
         that file, and the app stopped starting at login. A version manager that puts a
         folder per version on the PATH (nvm, fnm) still ties it to that version: once it is
         removed, "start" again from the Node in use -->
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
    <string>${xml(personPath())}</string>
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

/**
 * The PATH of the terminal that ran this, without what npm put ahead of it. Run through npx, the
 * PATH also holds npx's cache and the `node_modules/.bin` of the folder it was run from and of
 * every folder above it, and a login item started inside a project found that project's tools
 * first — `node` included — from then on. npm puts those first, then its own node-gyp-bin,
 * then the PATH it was given (@npmcli/run-script set-path.js).
 */
function personPath() {
  const dirs = (process.env.PATH ?? "").split(delimiter);
  const npm = dirs.findLastIndex((dir) => dir.endsWith(`${sep}node-gyp-bin`));
  return dirs.slice(npm + 1).join(delimiter);
}

/**
 * The job's file, written beside where it goes: moved into place, it is there whole or not at
 * all, and a full disk leaves the one before rather than half of a new one. Never writable by
 * the group, which launchd refuses to load. The staged path, for the caller to move.
 */
function stagePlist(text) {
  mkdirSync(AGENTS, { recursive: true });
  const staged = `${PLIST}.new`;
  rmSync(staged, { force: true });
  writeFileSync(staged, text, { mode: 0o644 });
  return staged;
}

/**
 * Takes the job out and waits for launchd to let go of it: it keeps the job's record until the
 * server has parked its jobs and exited, and a job loaded under the same name meanwhile is
 * refused as one already there. Blocking, for a Ctrl+C that has to finish before it exits.
 */
function bootOut() {
  const out = launchctl("bootout", `${domain()}/${LABEL}`);
  const pause = new Int32Array(new SharedArrayBuffer(4));
  for (let waited = 0; waited < FREE_MS && jobState(); waited += 250)
    Atomics.wait(pause, 0, 0, 250);
  return out;
}

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

/**
 * Whether a copy installed under PROGRAM is whole, of this version and for this machine. npm
 * writes a package's files in no order that ends on one to look for: a copy cut short — killed,
 * the power gone — held its manifest and its server and not the rest, and a data folder carried
 * to a Mac of the other kind carries native code that does not run there. The mark is written
 * once npm has finished, for the machine it ran on.
 */
function intact(folder, version) {
  try {
    const mark = JSON.parse(readFileSync(join(folder, INSTALLED), "utf8"));
    return (
      mark.version === version &&
      mark.platform === process.platform &&
      mark.arch === process.arch
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
  if (same(root, installed) || intact(folder, version)) return installed;
  // Half a copy from an install that was cut short, or one for another machine
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
  let manifest = null;
  try {
    manifest = JSON.parse(
      readFileSync(join(installed, "package.json"), "utf8"),
    );
  } catch {
    // Said below
  }
  if (
    manifest?.version !== version ||
    !existsSync(join(installed, "server.js"))
  )
    throw new Error(`npm finished, but ${installed} is not a whole copy.`);
  writeFileSync(
    join(folder, INSTALLED),
    `${JSON.stringify({ version, platform: process.platform, arch: process.arch })}\n`,
  );
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
 * Writes back and loads the job file there was before a start that did not work; with none
 * before, no job is left behind to fail again at every login. Whether one was loaded.
 */
function reload(before) {
  if (before !== null) {
    try {
      renameSync(stagePlist(before), PLIST);
      if (launchctl("bootstrap", domain(), PLIST).status === 0) return true;
    } catch {
      // Said by the caller: nothing runs in the background
    }
  }
  rmSync(PLIST, { force: true });
  return false;
}

/**
 * Puts back the job there was, and says whether it serves again. One that no longer can — its
 * database already moved on by the version that failed, its copy gone — is taken out too: left
 * in, launchd would start it every half minute and at every login. The line to print.
 */
async function putBack(before, job) {
  if (!reload(before))
    return before === null
      ? "Nothing runs in the background now."
      : "The one that ran before could not be started again, so nothing runs in the background now.";
  if (!job?.port) return "The one that ran before is loaded again.";
  if (await waitUp(job.port, job.home))
    return `The one that ran before runs again: http://localhost:${job.port}`;
  bootOut();
  rmSync(PLIST, { force: true });
  return "The one that ran before did not come back either, so nothing runs in the background now.";
}

/** How far the log runs now, so a failure shows only what this start wrote after it. */
function logSize(log) {
  try {
    return statSync(log).size;
  } catch {
    return 0;
  }
}

/**
 * The last lines the log gained since `from`, for a start that did not come up. Read from its
 * end: launchd only ever appends to it, and it grows for as long as the job runs.
 */
function logTail(log, from, lines = 12) {
  let fd;
  try {
    fd = openSync(log, "r");
    const size = fstatSync(fd).size;
    const start = Math.max(from, size - 16_384);
    const text = Buffer.alloc(Math.max(0, size - start));
    readSync(fd, text, 0, text.length, start);
    return text.toString("utf8").trimEnd().split("\n").slice(-lines);
  } catch {
    return [];
  } finally {
    if (fd !== undefined) closeSync(fd);
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
 * Waits for the job to serve a page on this folder. The page alone is not enough: a server a
 * terminal started meanwhile answers on the same port, and was taken for the job while the job
 * failed. A job that stopped with a failure meanwhile is not waited on — launchd would start
 * it again in half a minute, and it would fail the same way.
 */
async function waitUp(port, home) {
  const until = Date.now() + UP_MS;
  const since = Date.now();
  while (Date.now() < until) {
    const state = jobState();
    if (!state) return false;
    if (
      state.pid &&
      heldBy(runningOn(home), state.pid) &&
      (await answers(port))
    )
      return true;
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

/**
 * Takes the start lock. The process of the start that holds it, when another does; a lock left
 * by a start that was killed names a process that is gone, and is taken over. A temporary folder
 * that cannot be written costs only this guard.
 */
function holdStart() {
  const mine = JSON.stringify({
    pid: process.pid,
    startedUtc: startedAt(process.pid, "UTC") || undefined,
  });
  for (let tries = 0; tries < 2; tries++) {
    try {
      writeFileSync(START_LOCK, mine, { flag: "wx" });
      return null;
    } catch (error) {
      if (error?.code !== "EEXIST") return null;
    }
    let held = null;
    try {
      held = JSON.parse(readFileSync(START_LOCK, "utf8"));
    } catch {
      // Unreadable: nobody's
    }
    if (Number.isInteger(held?.pid) && stillRuns(held)) return held.pid;
    rmSync(START_LOCK, { force: true });
  }
  return null;
}

const letGoOfStart = () => {
  try {
    if (JSON.parse(readFileSync(START_LOCK, "utf8")).pid === process.pid)
      rmSync(START_LOCK, { force: true });
  } catch {
    // Gone already
  }
};

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
 * there — another version, another data folder, another port, or one that stopped — is
 * replaced, and put back if the new one does not come up. True once it serves; "held" when
 * another server or another start holds this folder, so nothing is to be served here either;
 * false otherwise. Everything it could not do is said before it returns.
 */
export async function startInBackground({
  root,
  home,
  port: asked,
  open,
  version,
}) {
  if (!mac()) {
    fail([
      "Running in the background is macOS only for now.",
      `Elsewhere, run ${commandFor("", home)} in a terminal and leave it open,`,
      "or add it to the programs that start when you log in.",
    ]);
    return false;
  }
  const another = holdStart();
  if (another) {
    fail([
      `Another start is setting it up already (process ${another}).`,
      "Run this again once it is done.",
    ]);
    return "held";
  }
  try {
    return await replaceJob({ root, home, asked, open, version });
  } finally {
    letGoOfStart();
  }
}

async function replaceJob({ root, home, asked, open, version }) {
  const command = thursdayCommand();
  const state = jobState();
  const job = backgroundJob();
  const running = runningOn(home);
  // A server on this folder that is not the job: two must never share one database, and
  // stopping a person's terminal for them is not this command's to do
  if (running && !heldBy(running, state?.pid)) {
    fail([
      `Thursday is already running on this data folder${running.url ? `: ${running.url}` : ""}`,
      ...stopLines(running.pid, home),
      "Then run this again.",
    ]);
    return "held";
  }
  // Nothing to change: this version serves this folder already, on the port asked for, from a
  // job this version wrote. One an earlier `autostart` wrote is written again
  if (
    running &&
    job?.home === home &&
    !job.legacy &&
    running.version === version &&
    (asked === undefined || Number(asked) === job.port)
  ) {
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
  const busy = [
    `Something else serves on port ${port}.`,
    "Stop it, or choose another with --port, and run this again.",
  ];
  if (!(state?.pid && job?.port === port) && (await portTaken(port))) {
    fail(busy);
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

  // Written before the job there is stopped: a folder that cannot be written, or a full disk,
  // then leaves what runs running
  const log = join(home, LOG_FILE);
  let staged;
  try {
    mkdirSync(home, { recursive: true });
    staged = stagePlist(
      plistOf({ cli: join(program, "bin", "thursday.mjs"), home, port, log }),
    );
  } catch (error) {
    fail([
      `Could not write ${PLIST}:`,
      String(error?.message ?? error),
      "",
      "Nothing was changed. Your data is as it was.",
    ]);
    return false;
  }

  // Not loaded is not a failure: this is also how an earlier job lets go before a new one
  const before = existsSync(PLIST) ? readFileSync(PLIST, "utf8") : null;
  // From here until the new one serves, the job there was is out: Ctrl+C, or the terminal
  // closed, loads it again rather than leave nothing, or a new job that may not work, loaded.
  // Heard once: npx passes the terminal's Ctrl+C on as a second one, which ended this halfway
  let interrupting = false;
  const interrupted = () => {
    if (interrupting) return;
    interrupting = true;
    bootOut();
    rmSync(staged, { force: true });
    say([
      "Stopped.",
      reload(before)
        ? "The one that ran before is loaded again."
        : "Nothing runs in the background now.",
    ]);
    // Exiting skips the `finally` that would
    letGoOfStart();
    process.exit(130);
  };
  const signals = ["SIGINT", "SIGTERM", "SIGHUP"];
  for (const signal of signals) process.on(signal, interrupted);
  try {
    if (state) {
      bootOut();
      if (job?.port) await waitFree(job.port);
    }
    if (!(await waitFree(port))) {
      rmSync(staged, { force: true });
      fail([...busy, await putBack(before, job)]);
      return false;
    }

    const from = logSize(log);
    try {
      renameSync(staged, PLIST);
    } catch (error) {
      fail([
        `Could not write ${PLIST}:`,
        String(error?.message ?? error),
        await putBack(before, job),
      ]);
      return false;
    }
    const started = launchctl("bootstrap", domain(), PLIST);
    if (started.status !== 0) {
      fail([
        "macOS refused to start it in the background:",
        started.stderr?.trim() || `launchctl exited ${started.status}`,
        await putBack(before, job),
      ]);
      return false;
    }

    if (!(await waitUp(port, home))) {
      // Taken back out: left in, launchd would start it every half minute and at every login,
      // failing the same way each time
      bootOut();
      // Read before the one that ran before writes to the same log again
      const why = logTail(log, from);
      const back = await putBack(before, job);
      fail([
        "It did not come up in the background. The log says why:",
        "",
        ...why,
        "",
        `Log: ${log}`,
        back,
        `Run in a terminal, ${commandFor("", home)}, and it can ask what to do about it.`,
      ]);
      return false;
    }
  } finally {
    for (const signal of signals) process.off(signal, interrupted);
  }
  pruneCopies(program);

  const url = `http://localhost:${port}`;
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

/**
 * Stops the background job, and it no longer starts at login. The data folder is untouched.
 * False when macOS kept it running, which is said.
 */
export async function stopBackground({ home }) {
  const job = backgroundJob();
  const state = mac() ? jobState() : null;
  const terminal = runningOn(home);

  if (!job && !state) {
    say([
      "Thursday was not running in the background.",
      ...(terminal ? stopLines(terminal.pid, home) : []),
    ]);
    return true;
  }

  if (state) {
    // A server slow to park its jobs keeps its record past the wait: a refusal is launchctl
    // saying it failed, with the job still loaded
    const out = bootOut();
    if (out.status !== 0 && jobState()) {
      fail([
        "macOS did not stop it:",
        out.stderr?.trim() || `launchctl exited ${out.status}`,
      ]);
      return false;
    }
  }
  rmSync(PLIST, { force: true });
  // A server parks its running jobs before it exits, which can outlast the wait
  const freed = !job?.port || (await waitFree(job.port));
  // Stopped on purpose: a later run in a terminal does not ask again
  markDecided(job?.home ?? home);
  say([
    "Thursday stopped, and no longer starts when you log in.",
    freed
      ? null
      : `Port ${job.port} is still in use; it may take a moment more.`,
    job ? `data: ${job.home} (kept as it is)` : null,
    `Start it again: ${commandFor("start", job?.home ?? home)}`,
  ]);
  return true;
}

/** Where Thursday runs, if it does, and how to reach and stop it. */
export function printStatus({ home }) {
  const command = thursdayCommand();
  const job = backgroundJob();
  const state = mac() && job ? jobState() : null;
  const served = job ? runningOn(job.home) : null;

  if (job && heldBy(served, state?.pid)) {
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
    const log = join(job.home, LOG_FILE);
    say([
      "Thursday is set to start when you log in, but is not running now.",
      failed(state?.exit)
        ? `It last stopped with exit ${state.exit}. The end of its log:`
        : "The end of its log:",
      "",
      ...logTail(log, 0, 6),
      "",
      `Log: ${log}`,
      `Try again: ${commandFor("start", job.home)}   ·   Stop trying: ${command} stop`,
    ]);
    return;
  }
  const terminal = runningOn(home);
  if (terminal) {
    say([
      `Thursday runs on this data folder${terminal.url ? `: ${terminal.url}` : ""}, not in the background.`,
      ...stopLines(terminal.pid, home),
      mac()
        ? `To run it in the background instead, stop it and run: ${commandFor("start", home)}`
        : null,
    ]);
    return;
  }
  say([
    "Thursday is not running.",
    mac() ? `In the background: ${commandFor("start", home)}` : null,
    `In this terminal:  ${commandFor("", home)}`,
  ]);
}

/**
 * The one question a first run asks: whether to keep Thursday running in the background.
 * Asked of a person at a terminal on a Mac, with no job yet and nothing decided before; a
 * checkout is someone working on the app, who runs it by hand. "background" once it runs
 * there, and this run has nothing left to do; "terminal" to serve here; "refused" when another
 * server or start took this folder while the question waited, and serving here would make two.
 */
export async function offerBackground({ root, home, port, open, version }) {
  if (!mac() || !process.stdin.isTTY || !process.stdout.isTTY)
    return "terminal";
  if (process.env.CI || isCheckout(root)) return "terminal";
  if (existsSync(PLIST) || existsSync(join(home, DECIDED_FILE)))
    return "terminal";

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
    return "terminal";
  }
  if (/^n/i.test(answer.trim())) {
    markDecided(home);
    console.log(
      `\n  It runs in this terminal until you close it.\n  To keep it running in the background later: ${commandFor("start", home)}`,
    );
    return "terminal";
  }
  const started = await startInBackground({ root, home, port, open, version });
  if (started === true) return "background";
  if (started === "held") return "refused";
  console.log("  Running it in this terminal instead.");
  return "terminal";
}
