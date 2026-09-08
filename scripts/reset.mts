#!/usr/bin/env node
// Interactive wipe of build, history, database and workspace.
// Run by `node`, not `tsx`: it deletes node_modules, so it imports nothing from there.
// No `@/` alias: Node does not read tsconfig paths.

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { join, relative } from "node:path";
import { createInterface, emitKeypressEvents } from "node:readline";
// node:sqlite is built into Node 22.13+.
import { DatabaseSync } from "node:sqlite";
// config.ts has no dependencies; folder names must match what the app uses.
import { DATA_DIR, DB_FILE_NAME, PATHS } from "../config.ts";

/** The checkout; the build lives here. */
const ROOT = join(import.meta.dirname, "..");
/** libsql spells it `file:/…/local.db`; on disk it is the part after the scheme. */
const DB_PATH = DB_FILE_NAME.replace(/^file:/, "");
/** Display name for the list. */
const DB_FILE = relative(ROOT, DB_PATH) || DB_PATH;

/**
 * Usage data (calls, jobs, memory); keys, bots and connectors stay. The same set
 * the app's own Reset history offers (features/thursday/thursday.action). Roots
 * only: children cascade via `onDelete: cascade` in database/tables.ts, and a
 * table referencing a root without cascade fails the delete instead of being
 * wiped. `memory_tidy_run` names calls without a foreign key, so it is a root
 * of its own rather than a cascade.
 */
const HISTORY_ROOTS = ["call", "task", "memory_note", "memory_tidy_run"];

type Group = {
  name: string;
  note: string;
  /** Is there anything to wipe. */
  live: () => boolean;
  /** How big, for the list. */
  measure: () => string;
  wipe: () => void;
  size?: string;
};

const sizeOf = (path: string) => {
  try {
    return execFileSync("du", ["-sh", path], { encoding: "utf8" })
      .split("\t")[0]
      .trim();
  } catch {
    return "?";
  }
};

/** A group that is files on disk. */
const files = (name: string, note: string, paths: string[]): Group => {
  const found = () => paths.filter(existsSync);
  return {
    name,
    note,
    live: () => found().length > 0,
    measure: () => found().map(sizeOf).join(" + "),
    // node_modules changes under its own delete: a watcher or an editor writing one
    // file back answers ENOTEMPTY on a directory just emptied. Retrying re-walks what
    // is left, which one pass reports as a fatal error instead.
    wipe: () => {
      for (const path of found())
        rmSync(path, {
          recursive: true,
          force: true,
          maxRetries: 3,
          retryDelay: 100,
        });
    },
  };
};

/** Roots plus the tables that cascade from them, read from the schema. Empty when the DB has no tables yet. */
function historyTables(db: DatabaseSync): string[] {
  const tables = (
    db.prepare("select name from sqlite_master where type = 'table'").all() as {
      name: string;
    }[]
  ).map((row) => row.name);
  if (!tables.length) return [];

  const missing = HISTORY_ROOTS.filter((root) => !tables.includes(root));
  if (missing.length) {
    throw new Error(
      `No such table: ${missing.join(", ")} — HISTORY_ROOTS has drifted from database/tables.ts`,
    );
  }

  const children = tables.filter((table) =>
    (
      db.prepare(`pragma foreign_key_list("${table}")`).all() as {
        table: string;
        on_delete: string;
      }[]
    ).some(
      (fk) => HISTORY_ROOTS.includes(fk.table) && fk.on_delete === "CASCADE",
    ),
  );
  return [...children, ...HISTORY_ROOTS];
}

function countHistory(): number {
  if (!existsSync(DB_PATH)) return 0;
  const db = new DatabaseSync(DB_PATH, { readOnly: true });
  try {
    return historyTables(db).reduce(
      (sum, table) =>
        sum +
        Number(
          (
            db.prepare(`select count(*) as n from "${table}"`).get() as {
              n: number;
            }
          ).n,
        ),
      0,
    );
  } finally {
    db.close();
  }
}

function wipeHistory() {
  // Foreign keys on: cascades run, and a non-cascading reference stops the delete.
  const db = new DatabaseSync(DB_PATH, { enableForeignKeyConstraints: true });
  try {
    db.exec("begin");
    for (const root of HISTORY_ROOTS) db.exec(`delete from "${root}"`);
    db.exec("commit");
    // Reclaim the space of deleted rows.
    db.exec("vacuum");
  } finally {
    db.close();
  }
}

/** Grouped by where a thing lives. */
const GROUPS: Group[] = [
  files(
    "Build",
    ".next, node_modules, type cache",
    [".next", "node_modules", "tsconfig.tsbuildinfo", "next-env.d.ts"].map(
      (p) => join(ROOT, p),
    ),
  ),
  {
    name: "History",
    note: "calls, tasks, memory — keys, bots and connectors stay",
    live: () => countHistory() > 0,
    measure: () => `${countHistory()} rows`,
    wipe: wipeHistory,
  },
  files(
    "Database",
    // Keys live in configTable, not .env, so this takes them too.
    `${DB_FILE} — everything: api keys, bots, connectors, and the history above`,
    // WAL mode keeps two sidecars next to the file.
    [DB_PATH, `${DB_PATH}-wal`, `${DB_PATH}-shm`],
  ),
  files(
    "Workspace",
    "files the agent wrote, and the user's own skills",
    // Under DATA_DIR (config).
    [PATHS.workspace, PATHS.skills.custom].map((p) => join(DATA_DIR, p)),
  ),
];

const present = GROUPS.filter((group) => group.live());
for (const group of present) group.size = group.measure() || "—";

if (!present.length) {
  console.log("\nNothing to wipe.\n");
  process.exit(0);
}
if (!process.stdin.isTTY) {
  console.error("Run this from a terminal — someone has to choose.");
  process.exit(1);
}

const picked = new Set<number>();
let cursor = 0;

function draw(first: boolean) {
  if (!first) process.stdout.write(`\x1b[${present.length + 4}A`);
  process.stdout.write("\x1b[0J");
  console.log("\n  What should go\n");
  present.forEach((group, at) => {
    const mark = picked.has(at) ? "\x1b[32m◉\x1b[0m" : "◯";
    const head = at === cursor ? "\x1b[36m❯\x1b[0m" : " ";
    const size = (group.size ?? "").padEnd(10);
    console.log(
      `  ${head} ${mark} ${group.name.padEnd(10)} \x1b[2m${size} ${group.note}\x1b[0m`,
    );
  });
  console.log(
    "\n  \x1b[2m↑↓ move   space pick   a all   enter wipe   q cancel\x1b[0m",
  );
}

function choose(): Promise<number[] | null> {
  return new Promise((done) => {
    emitKeypressEvents(process.stdin);
    process.stdin.setRawMode(true);
    process.stdin.resume();
    draw(true);

    const onKey = (_str: string, key: { name: string; ctrl: boolean }) => {
      const size = present.length;
      if (key.name === "up") cursor = (cursor - 1 + size) % size;
      else if (key.name === "down") cursor = (cursor + 1) % size;
      else if (key.name === "space")
        picked.has(cursor) ? picked.delete(cursor) : picked.add(cursor);
      else if (key.name === "a")
        picked.size === size
          ? picked.clear()
          : present.forEach((_, at) => picked.add(at));
      else if (key.name === "return" || key.name === "q" || key.ctrl) {
        process.stdin.setRawMode(false);
        process.stdin.pause();
        process.stdin.off("keypress", onKey);
        console.log();
        return done(key.name === "return" ? [...picked] : null);
      }
      draw(false);
    };
    process.stdin.on("keypress", onKey);
  });
}

const ask = (question: string): Promise<string> =>
  new Promise((done) => {
    const rl = createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    rl.question(question, (answer) => {
      rl.close();
      done(answer.trim());
    });
  });

/** Runs a command quietly. */
const hush = (cmd: string, args: string[]) =>
  spawnSync(cmd, args, { stdio: "ignore" });

// A running server would keep a handle to the deleted database.
function stopEverything() {
  hush("pkill", ["-f", "next dev"]);
}

const chosen = await choose();
if (!chosen?.length) {
  console.log("Cancelled.\n");
  process.exit(0);
}

const groups = chosen.map((at) => present[at]);
console.log(`  Wiping ${groups.map((g) => g.name).join(", ")}. No undo.`);
if (!/^y/i.test(await ask("  Sure? [y/N] "))) {
  console.log("Cancelled.\n");
  process.exit(0);
}

console.log();
stopEverything();
// The picks are independent: one group failing is not a reason to skip the rest.
let failed = false;
for (const group of groups) {
  try {
    group.wipe();
    console.log(`  \x1b[32m✓\x1b[0m ${group.name}`);
  } catch (error) {
    failed = true;
    console.log(
      `  \x1b[31m✗\x1b[0m ${group.name} — ${(error as Error).message}`,
    );
  }
}
if (failed) process.exitCode = 1;

const build = groups.some((g) => g.name === "Build");
console.log(`\n  Back up with: ${build ? "pnpm install && " : ""}pnpm dev\n`);
