#!/usr/bin/env node
// A canvas of options: boards pinned on one pan/zoom surface in the bot's artifacts
// folder, and every board as a picture of its own.
//
//   node canvas.mjs new <name>           the canvas, styled, to write boards into
//   node canvas.mjs shots <name|path>    every board as a PNG beside it, each at its own size
import { spawnSync } from "node:child_process";
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
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SKILL = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT = join(SKILL, "scripts", "canvas.mjs");
const NAME = /^[\p{L}\p{N}][\p{L}\p{N}_-]{0,79}$/u;

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
// The shipped skills, where the browser skill's renderer takes the pictures: named in a
// bot's shell, and otherwise the folder this skill itself sits in beside it
const SKILLS = process.env.THURSDAY_SKILLS || resolve(SKILL, "..");
/** The shell every kind wears (shell/ beside the skills): its stylesheet, its script. */
const shell = (file) =>
  readFileSync(join(SKILLS, "shell", file), "utf8").trim();

/** Whose folder this is written into: `artifacts/<bot>` names the bot, or nobody. */
const botName = () => {
  const dir = process.env.THURSDAY_ARTIFACTS || "";
  const name = dir.replace(/\/+$/, "").split("/").pop() ?? "";
  return name && name !== "artifacts" ? name : "";
};

/** A path as the reader should type it: short from the workspace, whole from outside it. */
const shown = (path) => {
  const near = relative(WORKSPACE, path);
  if (!near) return ".";
  return near.startsWith("..") ? path : near;
};

class Stop extends Error {}

/** `<name>/<name>.html` in the bot's artifacts folder: the canvas, with its pictures beside it. */
function fileFor(name) {
  if (!name || !NAME.test(name))
    throw new Stop(
      `${name ? `"${name}" is not` : "Give"} a canvas name: letters, numbers, - and _ only.`,
    );
  return join(
    WORKSPACE,
    process.env.THURSDAY_ARTIFACTS || "artifacts",
    name,
    `${name}.html`,
  );
}

/**
 * What `shots` was pointed at. A name is this bot's own canvas. A path — the file, or the
 * folder holding it — is how a canvas another bot made is shot: work handed over lands in
 * the folder of whoever it was handed to, which no name of mine reaches.
 */
function sourceFor(arg) {
  if (!arg) throw new Stop("Give a canvas name, or the path to one.");
  if (!arg.includes("/") && !arg.endsWith(".html")) return fileFor(arg);
  const path = resolve(arg);
  return existsSync(path) && statSync(path).isDirectory()
    ? join(path, `${basename(path)}.html`)
    : path;
}

function newCanvas(name) {
  const out = fileFor(name);
  if (existsSync(out))
    throw new Stop(`${shown(out)} already exists. Edit it there.`);
  const part = (ext) =>
    readFileSync(join(SKILL, "canvas", `canvas.${ext}`), "utf8").trim();
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(
    out,
    part("html")
      .replaceAll("{{title}}", name)
      .replaceAll("{{bot}}", botName())
      .replace("/* shell.css */", () => shell("shell.css"))
      .replace("// shell.theme", () => shell("theme.js"))
      .replace("/* canvas.css */", () => part("css"))
      .replace("// shell.js", () => shell("shell.js"))
      .replace("// canvas.js", () => part("js")),
  );
  console.log(
    `${shown(out)} is ready: one file that opens offline, and opens fitted. Copy a board from ${join(SKILL, "boards")} for each option and change what is on it (the comment inside says how), then run: node ${SCRIPT} shots ${name}`,
  );
}

/** Every board's size, in the order the boards are written: what each picture must be. */
function boardSizes(html) {
  const sizes = [];
  for (const [, style] of html.matchAll(
    /<article\b[^>]*\bclass="[^"]*\bframe\b[^"]*"[^>]*\bstyle="([^"]*)"/g,
  )) {
    const w = /--w:\s*(\d+)/.exec(style);
    const h = /--h:\s*(\d+)/.exec(style);
    if (!w || !h)
      throw new Stop(
        'A board has no size: every <article class="frame"> carries --w and --h in its style, as the ones in boards/ do.',
      );
    sizes.push({ w: Number(w[1]), h: Number(h[1]) });
  }
  return sizes;
}

async function shotCanvas(name) {
  const file = sourceFor(name);
  if (!existsSync(file))
    throw new Stop(
      `No canvas ${shown(file)}. Start one with: node ${SCRIPT} new <name>, or give the path to one that exists.`,
    );
  const sizes = boardSizes(readFileSync(file, "utf8"));
  if (!sizes.length)
    throw new Stop(
      `${shown(file)} holds no board: a board is one <article class="frame"> with a <div class="board" data-slide> inside.`,
    );

  // The renderer shoots every `[data-slide]` at the size it is drawn, and cannot see a
  // board the canvas has scaled to fit the window. So it is given a flat copy — the boards
  // alone, at true size — in a dot-folder the app's screens do not list, with whatever
  // sits beside the canvas, since a picture a board points at sits beside it.
  const dir = dirname(file);
  const flat = join(dir, ".shots");
  const copy = join(flat, file.slice(dir.length + 1));
  rmSync(flat, { recursive: true, force: true });
  mkdirSync(flat, { recursive: true });
  writeFileSync(
    copy,
    readFileSync(file, "utf8").replace(/<body(?=[\s>])/, '<body class="shot"'),
  );
  for (const entry of readdirSync(dir, { withFileTypes: true }))
    if (entry.isFile() && join(dir, entry.name) !== file)
      copyFileSync(join(dir, entry.name), join(flat, entry.name));

  const scripts = join(SKILLS, "browser", "scripts");
  const done = spawnSync(
    process.execPath,
    [join(scripts, "render.mjs"), copy, "--out", dir, "--name", "board"],
    { stdio: "inherit" },
  );
  rmSync(flat, { recursive: true, force: true });
  // The renderer has already named what went wrong — a picture that did not load, no browser
  if (done.status !== 0)
    throw new Stop("Fix what it names above, then run this again.");

  // A board that overflows grows in the flat copy instead of clipping, so its picture comes
  // out taller than the size it was written at. Named here by board, as the canvas itself
  // marks it `cut`.
  const { imageSize } = await import(
    pathToFileURL(join(scripts, "image-size.mjs")).href
  );
  const wrong = [];
  sizes.forEach((size, i) => {
    const png = join(dir, `board-${String(i + 1).padStart(2, "0")}.png`);
    const got = existsSync(png) && imageSize(png);
    if (!got || got.w !== size.w || got.h !== size.h)
      wrong.push(
        `board ${i + 1} is ${got ? `${got.w}x${got.h}` : "missing"}, not ${size.w}x${size.h}`,
      );
  });
  if (wrong.length)
    throw new Stop(
      `${wrong.join("; ")}. What is on it does not fit it: cut, tighten or split it, then run this again.`,
    );
  console.log(
    `The boards are pictures in ${shown(dir)}. Hand back the canvas and every board picture, so both are in front of whoever chooses.`,
  );
}

const commands = { new: newCanvas, shots: shotCanvas };
const [command, ...rest] = process.argv.slice(2);
try {
  if (!commands[command])
    throw new Stop("Usage: canvas.mjs new <name> | shots <name|path>");
  await commands[command](...rest);
} catch (error) {
  // A `Stop` is a line for the reader, not a stack
  if (!(error instanceof Stop)) throw error;
  console.error(error.message);
  process.exit(1);
}
