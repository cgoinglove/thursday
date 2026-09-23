#!/usr/bin/env node
// A page someone uses, built as a small React app on one shared kit — React, TypeScript,
// Tailwind CSS, shadcn/ui, recharts, react-markdown — installed once into the workspace from
// the pinned lockfile beside this skill, and bundled into one HTML file that opens offline.
// The kit's shape follows Anthropic's web-artifacts-builder (Apache-2.0, LICENSE.txt); vite
// with vite-plugin-singlefile builds it, and the versions are pinned rather than fetched.
//
//   node app.mjs new <name>          start a page in the kit
//   node app.mjs build <name>        bundle it into one offline HTML file in the artifacts folder
//   node app.mjs add <package>...    add a library the kit lacks; every page can use it after
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
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SKILL = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const TEMPLATE = join(SKILL, "runtime", "kit");
const PAGE_TEMPLATE = join(SKILL, "runtime", "page");
const SCRIPT = join(SKILL, "scripts", "app.mjs");

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
  // The lock sits beside the kit: without its folder mkdir can never take it, and the loop
  // below would spin rather than wait
  mkdirSync(dirname(LOCK), { recursive: true });
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
  else
    throw new Stop(
      "Usage: app.mjs new <name> | build <name> | add <package>...",
    );
} catch (error) {
  if (!(error instanceof Stop)) throw error;
  console.error(error.message);
  process.exitCode = 1;
}
