#!/usr/bin/env node
// Pages built on one shared kit (React, Tailwind, shadcn/ui, recharts, react-markdown),
// installed once into the workspace and reused by every page after it.
//
//   node page.mjs new <name>        start a page in the kit
//   node page.mjs build <name>      bundle it into one offline HTML file in the artifacts folder
//   node page.mjs add <package>...  add a library the kit lacks; every page can use it after
//   node page.mjs quick <name> [--from <kind>]
//                                   one hand-written HTML file, styled, no kit — from a ready
//                                   document (quick/pages: report, memo, comparison, plan,
//                                   notes) or blank
//   node page.mjs put <name|path> <file>
//                                   the document's body written in <file>, into that page
//   node page.mjs shots <name|path> the page as it opens, down to three pictures in scratch/
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { notInside, putBetween } from "../../shell/put.mjs";
import { wear } from "../../shell/wear.mjs";

const SKILL = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const TEMPLATE = join(SKILL, "kit");
const PAGE_TEMPLATE = join(SKILL, "page");
const SCRIPT = join(SKILL, "scripts", "page.mjs");

/** The app's workspace: the nearest folder above holding its fence and a `projects` folder. */
function findWorkspace() {
  for (let dir = process.cwd(); ; dir = dirname(dir)) {
    if (
      existsSync(join(dir, "pnpm-workspace.yaml")) &&
      existsSync(join(dir, "projects"))
    )
      return dir;
    if (dir === dirname(dir)) return process.cwd();
  }
}

const WORKSPACE = findWorkspace();
const KIT = join(WORKSPACE, "projects", ".page-kit");
const LOCK = `${KIT}.lock`;
const STAMP = join(KIT, ".kit.json");
const VITE = join(KIT, "node_modules", "vite", "bin", "vite.js");
const shown = (path) => relative(WORKSPACE, path) || ".";

class Stop extends Error {}

function run(command, args, env) {
  const done = spawnSync(command, args, {
    cwd: KIT,
    stdio: "inherit",
    env: { ...process.env, ...env },
    shell: process.platform === "win32",
  });
  return done.status === 0;
}

function npm(args) {
  if (!run("npm", [...args, "--no-audit", "--no-fund", "--loglevel=error"]))
    throw new Stop(
      `npm ${args[0]} failed in ${shown(KIT)}; its output above says why.`,
    );
}

function templateStamp() {
  const hash = createHash("sha256");
  const walk = (dir) => {
    const entries = readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name),
    );
    for (const entry of entries) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else
        hash.update(`${relative(TEMPLATE, path)}\0`).update(readFileSync(path));
    }
  };
  walk(TEMPLATE);
  return hash.digest("hex");
}

const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));
const dependencies = (path) => {
  const pkg = readJson(path);
  return { ...pkg.dependencies, ...pkg.devDependencies };
};
const readStamp = () => (existsSync(STAMP) ? readJson(STAMP) : null);

// An install or an update holds the lock; a build only waits for it, so pages
// build side by side.
const LOCK_STALE_MS = 20 * 60_000;
function waitForLock() {
  while (existsSync(LOCK)) {
    if (Date.now() - statSync(LOCK).mtimeMs > LOCK_STALE_MS) {
      rmSync(LOCK, { recursive: true, force: true });
      return;
    }
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1000);
  }
}
function withLock(work) {
  for (;;) {
    try {
      mkdirSync(LOCK);
      break;
    } catch {
      waitForLock();
    }
  }
  try {
    work();
  } finally {
    rmSync(LOCK, { recursive: true, force: true });
  }
}

/** Installs the kit the first time, and again when the app ships a newer one. */
function ensureKit() {
  waitForLock();
  const stamp = templateStamp();
  if (readStamp()?.stamp === stamp && existsSync(VITE)) return;

  withLock(() => {
    const kept = readStamp();
    if (kept?.stamp === stamp && existsSync(VITE)) return;

    // Libraries a page added since the last install, kept across an update
    const extras = [];
    if (kept && existsSync(join(KIT, "package.json"))) {
      const shipped = kept.dependencies ?? {};
      for (const [name, version] of Object.entries(
        dependencies(join(KIT, "package.json")),
      ))
        if (!(name in shipped)) extras.push(`${name}@${version}`);
    }

    console.error(
      kept
        ? "Updating the page kit to the one this app ships…"
        : "Installing the page kit, once for every page after this (a minute or two)…",
    );
    mkdirSync(KIT, { recursive: true });
    cpSync(TEMPLATE, KIT, { recursive: true, force: true });
    npm(["ci"]);
    if (extras.length) npm(["install", ...extras]);
    const shipped = dependencies(join(TEMPLATE, "package.json"));
    writeFileSync(
      STAMP,
      `${JSON.stringify({ stamp, dependencies: shipped }, null, 2)}\n`,
    );
  });
}

const NAME = /^[\p{L}\p{N}][\p{L}\p{N}_-]{0,79}$/u;
function pageDir(name) {
  if (!name || !NAME.test(name))
    throw new Stop(
      `${name ? `"${name}" is not` : "Give"} a page name: letters, numbers, - and _ only.`,
    );
  return join(KIT, "pages", name);
}

function newPage(name) {
  const dir = pageDir(name);
  ensureKit();
  if (existsSync(dir))
    throw new Stop(
      `Page "${name}" already exists in ${shown(dir)}. Edit it there and build again.`,
    );
  cpSync(PAGE_TEMPLATE, dir, { recursive: true });
  const html = join(dir, "index.html");
  writeFileSync(html, readFileSync(html, "utf8").replace("{{title}}", name));
  console.log(
    `Page "${name}" is ready. Write it in ${shown(join(dir, "src", "App.tsx"))} (more files beside it as needed), then: node ${SCRIPT} build ${name}`,
  );
}

function buildPage(name) {
  const dir = pageDir(name);
  if (!existsSync(dir))
    throw new Stop(
      `No page "${name}" in ${shown(join(KIT, "pages"))}. Start it with: node ${SCRIPT} new ${name}`,
    );
  ensureKit();
  if (!run(process.execPath, [VITE, "build"], { PAGE: name }))
    throw new Stop(
      `The build of "${name}" failed; fix what it names and build again.`,
    );

  const out = join(
    WORKSPACE,
    process.env.THURSDAY_ARTIFACTS || "artifacts",
    `${name}.html`,
  );
  mkdirSync(dirname(out), { recursive: true });
  copyFileSync(join(dir, "dist", "index.html"), out);
  const kb = Math.round(statSync(out).size / 1024);
  console.log(
    `Built ${shown(out)} (${kb} KB), one file that opens offline. Hand back this path.`,
  );
}

/**
 * A page with nothing to build: one HTML file in the bot's artifacts folder, the quick
 * stylesheet and script inlined, its body a ready document (`--from`) or blank, written
 * by hand from there. No kit is installed for it.
 */
function quickPage(name, ...args) {
  if (!name || !NAME.test(name))
    throw new Stop(
      `${name ? `"${name}" is not` : "Give"} a page name: letters, numbers, - and _ only.`,
    );
  const quick = join(SKILL, "quick");
  const kinds = readdirSync(join(quick, "pages"))
    .filter((file) => file.endsWith(".html"))
    .map((file) => file.slice(0, -5));
  const at = args.indexOf("--from");
  const kind = at === -1 ? "blank" : (args[at + 1] ?? "");
  if (!kinds.includes(kind))
    throw new Stop(
      `No ready document "${kind}": --from takes one of ${kinds.filter((k) => k !== "blank").join(", ")}.`,
    );
  const out = join(
    WORKSPACE,
    process.env.THURSDAY_ARTIFACTS || "artifacts",
    `${name}.html`,
  );
  if (existsSync(out))
    throw new Stop(`${shown(out)} already exists. Edit it there.`);
  const part = (path) => readFileSync(join(quick, path), "utf8").trim();
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(
    out,
    wear(
      part("quick.html")
        .replace("{{body}}", () => part(join("pages", `${kind}.html`)))
        .replace("{{css}}", () => part("quick.css"))
        .replace("{{js}}", () => part("quick.js"))
        .replaceAll("{{title}}", name),
    ),
  );
  console.log(
    `${shown(out)} is ready: one file that opens offline, styled already${kind === "blank" ? "" : `, laid out as a ${kind}`}. Write its body in plain HTML in a file of your own from what is there (the comment inside says what each part is for), then run: node ${SCRIPT} put ${name} <that file> && node ${SCRIPT} shots ${name} — and hand back this path.`,
  );
}

/** A page in the bot's artifacts folder by name, or any page by its path. */
function pageAt(arg) {
  if (!arg) throw new Stop("Give a page name, or the path to one.");
  const file =
    !arg.includes("/") && !arg.endsWith(".html")
      ? join(
          WORKSPACE,
          process.env.THURSDAY_ARTIFACTS || "artifacts",
          `${arg}.html`,
        )
      : resolve(arg);
  if (!existsSync(file))
    throw new Stop(
      `No page ${shown(file)}. Start one with: node ${SCRIPT} quick <name>, or give the path to one that exists.`,
    );
  return file;
}

/** The body written in `from` in place of the document's own, and nothing else of it touched. */
function putBody(name, from) {
  const file = pageAt(name);
  if (!from || !existsSync(from))
    throw new Stop(
      `Give the file the body is written in: node ${SCRIPT} put ${name ?? "<name>"} <file>`,
    );
  const body = readFileSync(from, "utf8");
  const why = notInside(body);
  if (why) throw new Stop(`${from} ${why}: the document's body alone.`);
  const html = putBetween(readFileSync(file, "utf8"), body);
  if (!html)
    throw new Stop(
      `${shown(file)} has no place to put a body: only a page made by \`quick\` has one, and one written over whole has lost it. Start a new one (node ${SCRIPT} quick <another name>) and put the body into it.`,
    );
  writeFileSync(file, html);
  console.log(
    `The body is in ${shown(file)}. Next: node ${SCRIPT} shots ${name}`,
  );
}

/**
 * The page as it opens, at the width the app draws it, as pictures to look at before it is
 * handed back: down the page, three windows at most. They are for checking, not for the
 * reader, so they go in scratch/, never beside the page among the finished work.
 */
function shotPage(name) {
  const file = pageAt(name);
  const out = join(WORKSPACE, "scratch", `${basename(file, ".html")}-shots`);
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  const skills = process.env.THURSDAY_SKILLS || resolve(SKILL, "..");
  const done = spawnSync(
    process.execPath,
    [
      join(skills, "browser", "scripts", "render.mjs"),
      file,
      "--out",
      out,
      "--size",
      "1024x1400",
      "--most",
      "3",
      "--name",
      "page",
      // Never in the job's own browser, which may be a window on their screen
      "--apart",
    ],
    { stdio: "inherit" },
  );
  if (done.status !== 0)
    throw new Stop("Fix what it names above, then run this again.");
  console.log(`Look at them with look_at, from ${shown(out)}.`);
}

function addPackages(names) {
  if (!names.length) throw new Stop("Name the package to add.");
  ensureKit();
  withLock(() => npm(["install", ...names]));
  console.log(
    `Added ${names.join(", ")} to the kit; every page can import it now.`,
  );
}

const [command, ...rest] = process.argv.slice(2);
try {
  if (command === "new") newPage(rest[0]);
  else if (command === "build") buildPage(rest[0]);
  else if (command === "add") addPackages(rest);
  else if (command === "quick") quickPage(...rest);
  else if (command === "put") putBody(...rest);
  else if (command === "shots") shotPage(rest[0]);
  else
    throw new Stop(
      "Usage: page.mjs quick <name> [--from <kind>] | put <name|path> <file> | shots <name|path> | new <name> | build <name> | add <package>...",
    );
} catch (error) {
  if (!(error instanceof Stop)) throw error;
  console.error(error.message);
  process.exitCode = 1;
}
