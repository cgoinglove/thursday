// Where things are, and the libraries every command reads and writes office files with:
// installed once into the workspace's `projects/.docs-kit`, again when the skill ships
// a newer lockfile.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { basename, dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const SKILL = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
export const SCRIPT = join(SKILL, "scripts", "doc.mjs");

/** A message for the person running the command, printed without a stack. */
export class Stop extends Error {}

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

export const WORKSPACE = findWorkspace();
export const shown = (path) => relative(WORKSPACE, path) || ".";

/** The bot's finished work: its folder under `artifacts/`, named in its shell. */
export const ARTIFACTS = join(
  WORKSPACE,
  process.env.THURSDAY_ARTIFACTS || "artifacts",
);

/** The shipped skills (THURSDAY_SKILLS): the browser's scripts come from there. */
export function shippedSkill(...parts) {
  const root = process.env.THURSDAY_SKILLS;
  if (!root)
    throw new Stop(
      "THURSDAY_SKILLS is not set: run this from a bot's shell, where it names the shipped skills.",
    );
  return join(root, ...parts);
}

/** A file the command reads: resolved from the shell's folder, and there. */
export function input(path, kinds) {
  if (!path) throw new Stop("Name the file to read.");
  const full = resolve(path);
  if (!existsSync(full)) throw new Stop(`No such file: ${path}`);
  const kind = extname(full).slice(1).toLowerCase();
  if (kinds && !kinds.includes(kind))
    throw new Stop(
      `${basename(full)} is not ${kinds.map((k) => `.${k}`).join(" or ")}.`,
    );
  return full;
}

/**
 * Where a result goes. A bare name lands in the artifacts folder; a path is taken as
 * written. The extension is the one the command makes.
 */
export function output(wanted, fallback, extension) {
  const name = wanted || fallback;
  const bare = !name.includes("/");
  const full = bare ? join(ARTIFACTS, name) : resolve(name);
  const withExt =
    extname(full).toLowerCase() === `.${extension}`
      ? full
      : `${full.replace(/\.[a-z0-9]{2,5}$/i, "")}.${extension}`;
  mkdirSync(dirname(withExt), { recursive: true });
  return withExt;
}

/** `a/b/report.docx` → `a/b/report.pdf`: a file's twin in another format. */
export const twin = (path, extension) =>
  `${path.replace(/\.[a-z0-9]{2,5}$/i, "")}.${extension}`;

/**
 * Where the pictures and working files for one document go: a hidden folder in the artifacts
 * folder, never beside a file of the user's own.
 */
export function workDir(file) {
  const dir = join(ARTIFACTS, ".work", basename(file));
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** Pictures an earlier run left in `dir`, so a shorter document shows no stale pages. */
export function clearPictures(dir) {
  for (const name of readdirSync(dir))
    if (/^(page|slide)-\d+\.png$|^(sheet|overview)\.png$/.test(name))
      rmSync(join(dir, name), { force: true });
}

// The kit: pinned by the skill's own lockfile, stamped with its hash
const KIT_SOURCE = join(SKILL, "kit");
const KIT = join(WORKSPACE, "projects", ".docs-kit");
const LOCK = `${KIT}.lock`;
const STAMP = join(KIT, ".kit.json");
const LOCK_STALE_MS = 10 * 60_000;

const stampOf = () =>
  createHash("sha256")
    .update(readFileSync(join(KIT_SOURCE, "package.json")))
    .update(readFileSync(join(KIT_SOURCE, "package-lock.json")))
    .digest("hex");

const installed = (stamp) =>
  existsSync(STAMP) &&
  JSON.parse(readFileSync(STAMP, "utf8")).stamp === stamp &&
  existsSync(join(KIT, "node_modules"));

const sleep = (ms) =>
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

function waitForLock() {
  while (existsSync(LOCK)) {
    if (Date.now() - statSync(LOCK).mtimeMs > LOCK_STALE_MS) {
      rmSync(LOCK, { recursive: true, force: true });
      return;
    }
    sleep(1000);
  }
}

function ensureKit() {
  const stamp = stampOf();
  waitForLock();
  if (installed(stamp)) return;
  for (;;) {
    try {
      mkdirSync(LOCK, { recursive: false });
      break;
    } catch {
      waitForLock();
    }
  }
  try {
    if (installed(stamp)) return;
    console.error(
      `Installing the document libraries into ${shown(KIT)}, once (about 10 seconds, 150 MB)…`,
    );
    mkdirSync(KIT, { recursive: true });
    for (const file of ["package.json", "package-lock.json"])
      copyFileSync(join(KIT_SOURCE, file), join(KIT, file));
    const done = spawnSync(
      "npm",
      ["ci", "--no-audit", "--no-fund", "--loglevel=error"],
      { cwd: KIT, stdio: ["ignore", "ignore", "inherit"] },
    );
    if (done.status !== 0)
      throw new Stop(
        `npm ci failed in ${shown(KIT)}; its output above says why.`,
      );
    writeFileSync(STAMP, `${JSON.stringify({ stamp })}\n`);
  } finally {
    rmSync(LOCK, { recursive: true, force: true });
  }
}

let kitRequire = null;

/** A module's namespace from the kit, installing the kit first when it is not there yet. */
export async function kit(name) {
  if (!kitRequire) {
    ensureKit();
    kitRequire = createRequire(join(KIT, "package.json"));
  }
  return import(pathToFileURL(kitRequire.resolve(name)).href);
}

/** A file shipped inside a kit package (fonts, pdf.js data). */
export function kitFile(...parts) {
  ensureKit();
  return join(KIT, "node_modules", ...parts);
}

/** `--name value`, `--name=value` and `--flag`, and the rest as positionals in `_`. */
export function parseArgs(argv) {
  const opts = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) {
      opts._.push(a);
      continue;
    }
    const [key, inline] = a.slice(2).split(/=(.*)/s);
    if (inline !== undefined) opts[key] = inline;
    else if (argv[i + 1] !== undefined && !argv[i + 1].startsWith("--"))
      opts[key] = argv[++i];
    else opts[key] = true;
  }
  return opts;
}

/** "1-3,5,8-" of `total` pages → [1,2,3,5,8,…,total]; empty means all. */
export function pageList(spec, total) {
  if (!spec || spec === true)
    return Array.from({ length: total }, (_, i) => i + 1);
  const pages = [];
  for (const part of String(spec).split(",")) {
    const m = /^\s*(\d+)?\s*(-)?\s*(\d+)?\s*$/.exec(part);
    if (!m || (!m[1] && !m[3]))
      throw new Stop(`"${part}" is not a page range (1-3,5,8-).`);
    const from = Number(m[1] ?? 1);
    const to = m[2] ? Number(m[3] ?? total) : from;
    for (let p = from; p <= to; p++) {
      if (p < 1 || p > total)
        throw new Stop(`Page ${p} is outside 1-${total}.`);
      pages.push(p);
    }
  }
  return pages;
}

export const readJson = (path) => {
  try {
    return JSON.parse(readFileSync(input(path), "utf8"));
  } catch (error) {
    if (error instanceof Stop) throw error;
    throw new Stop(`${path} is not valid JSON: ${error.message}`);
  }
};

export const escapeHtml = (text) =>
  String(text ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
