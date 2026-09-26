// One server to a data folder. A second one started on the same folder took the next port
// and, at its boot, parked the first one's running jobs, closed its open calls and joined
// the phone a second time, so every message was answered twice. The second is refused, and
// told where the first one is.

import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { backgroundJob } from "./background.mjs";
import { thursdayCommand } from "./tools.mjs";

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
  if (!stillRuns(held)) return null;
  return {
    pid: held.pid,
    url: String(held.url ?? ""),
    // Null from `pnpm dev`, and from a server started before the lock said
    version: typeof held.version === "string" ? held.version : null,
    background: held.background === true,
  };
}

/**
 * Whether the process a lock names is still the one that wrote it. A lock left by a process
 * that died without its exit (a kill -9, a power cut) names a pid another process may hold
 * after a restart, which would refuse every start until the file was deleted by hand: the pid
 * is the writer only if it started when the lock says. Where `ps` cannot say (Windows), or the
 * lock predates its start time, the live pid is all there is.
 */
export function stillRuns(held) {
  try {
    // Signal 0 asks whether the process exists and sends nothing
    process.kill(held.pid, 0);
  } catch (error) {
    // Someone else's process by that id is still a live one
    if (error?.code !== "EPERM") return false;
  }
  // Compared in UTC: `ps` writes the reader's zone, and a server under launchd (no TZ), a
  // terminal that exports one, or a Mac that moved zones since it started spelled one start
  // two ways — the server read as gone, and a second one opened the same database. A lock
  // written before `startedUtc` has `started` alone, in its writer's zone.
  const [said, zone] =
    typeof held.startedUtc === "string"
      ? [held.startedUtc, "UTC"]
      : [held.started, undefined];
  if (typeof said !== "string") return true;
  const started = startedAt(held.pid, zone);
  return !started || started === said;
}

/**
 * Whether the server holding this folder is `pid`, or runs under it: launchd knows a job by the
 * process it started, and a version manager's shim (Volta's) starts node as its child rather
 * than becoming it.
 */
export function heldBy(running, pid) {
  if (!running || !pid) return false;
  return (
    running.pid === pid ||
    Number(ps(["-o", "ppid=", "-p", String(running.pid)])) === pid
  );
}

// LC_ALL=C: a start time is compared as `ps` wrote it, so both reads spell it alike
const ps = (args, zone) =>
  spawnSync("ps", args, {
    encoding: "utf8",
    env: { ...process.env, LC_ALL: "C", ...(zone ? { TZ: zone } : {}) },
  }).stdout?.trim() ?? "";

/**
 * When a process started, to the second, as `ps` has it in `zone` (the reader's own when none).
 * Empty where it cannot say.
 */
export const startedAt = (pid, zone) =>
  ps(["-o", "lstart=", "-p", String(pid)], zone);

/**
 * Where a process runs, as `ps` has it: the terminal it is attached to (null when none), when
 * it started, and what was typed there — the leader of its process group, `pnpm dev` or
 * `npx thursday-agent`, not the Node process under it. Null where `ps` cannot say (Windows).
 */
function whereRuns(pid) {
  const [tty, group, ...started] = ps([
    "-o",
    "tty=,pgid=,lstart=",
    "-p",
    String(pid),
  ]).split(/\s+/);
  if (!tty || !group) return null;
  return {
    terminal: tty === "??" || tty === "?" ? null : tty,
    group,
    // "Fri Sep 25 20:55:51 2026" to the minute, in the reader's zone: it is read, not compared
    since: started.join(" ").replace(/:\d\d \d{4}$/, ""),
    typed: ps(["-o", "command=", "-p", group]),
  };
}

/**
 * How to stop the server with this pid, said where it can be done. A person told only "stop
 * it" looked for a terminal they could not find: the one it runs in is named, with a command
 * that does the same from any terminal. One that runs in the background is started again by
 * launchd, so it is stopped by stopping that. Lines to print, without indent.
 */
export function stopLines(pid, home) {
  const where = whereRuns(pid);
  if (where?.terminal)
    return [
      `It runs in a terminal (${where.terminal}${where.typed ? `, ${where.typed}` : ""}, since ${where.since}).`,
      `Ctrl+C there, or from any terminal: kill -INT -${where.group}`,
    ];
  if (backgroundJob()?.home === home)
    return [`It runs in the background. To stop it: ${thursdayCommand()} stop`];
  if (where) return [`It runs in the background. To stop it: kill ${pid}`];
  return ["Ctrl+C where it runs."];
}

/** Exits with where the running one is, when this folder already has a server. */
export function refuseSecond(home) {
  const running = runningOn(home);
  if (!running) return;
  console.error(
    `\n  Thursday is already running on this data folder${running.url ? `: ${running.url}` : ""}\n  Open that one, or stop it first.\n${stopLines(
      running.pid,
      home,
    )
      .map((line) => `  ${line}\n`)
      .join("")}`,
  );
  process.exit(1);
}

/** Marks this folder as served from here until this process ends. */
export function holdFolder(home, url, version) {
  const file = join(home, LOCK_FILE);
  try {
    mkdirSync(home, { recursive: true });
    writeFileSync(
      file,
      `${JSON.stringify({
        pid: process.pid,
        startedUtc: startedAt(process.pid, "UTC") || undefined,
        // What a starter from before `startedUtc` reads, in this process's zone
        started: startedAt(process.pid) || undefined,
        url,
        version,
        // Which one launchd started, so a stop can end it when launchd did not (background.mjs)
        background: process.env.THURSDAY_BACKGROUND ? true : undefined,
      })}\n`,
    );
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
