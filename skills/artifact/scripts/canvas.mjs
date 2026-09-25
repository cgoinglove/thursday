#!/usr/bin/env node
// A canvas of options: boards pinned on one pan/zoom surface in the bot's artifacts
// folder, and every board as a picture of its own.
//
//   node canvas.mjs new <name>                the canvas, styled, to write boards into
//   node canvas.mjs put <name|path> <file>    the boards written in <file>, into the canvas
//   node canvas.mjs get <name|path> <file>    the canvas's boards and notes as they are now, into <file>
//   node canvas.mjs shots <name|path>         every board as a PNG beside it, each at its own size
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
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  editedSince,
  getBetween,
  keep,
  notInside,
  putBetween,
} from "../runtime/shell/put.mjs";
import { wear } from "../runtime/shell/wear.mjs";
import { ARTIFACTS, NAME, Stop, shown } from "../runtime/shell/workspace.mjs";

const SKILL = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT = join(SKILL, "scripts", "canvas.mjs");

// The shipped skills, where the browser skill's renderer takes the pictures: named in a
// bot's shell, and otherwise the folder this skill itself sits in beside it
const SKILLS = process.env.THURSDAY_SKILLS || resolve(SKILL, "..");

/** `<name>/<name>.html` in the bot's artifacts folder: the canvas, with its pictures beside it. */
function fileFor(name) {
  if (!name || !NAME.test(name))
    throw new Stop(
      `${name ? `"${name}" is not` : "Give"} a canvas name: letters, numbers, - and _ only.`,
    );
  return join(ARTIFACTS, name, `${name}.html`);
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
    readFileSync(
      join(SKILL, "runtime", "canvas", `canvas.${ext}`),
      "utf8",
    ).trim();
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(
    out,
    wear(
      part("html")
        .replaceAll("{{title}}", name)
        .replace("/* canvas.css */", () => part("css"))
        .replace("// canvas.js", () => part("js")),
    ),
  );
  console.log(
    `${shown(out)} is ready: one file that opens offline, and opens fitted. Copy a board from ${join(SKILL, "templates", "boards")} for each option into a file of your own and change what is on it (the comment inside the canvas says how), then run: node ${SCRIPT} put ${name} <that file> && node ${SCRIPT} shots ${name}`,
  );
}

/** A canvas that exists, named or pointed at. */
function canvasAt(arg) {
  const file = sourceFor(arg);
  if (!existsSync(file))
    throw new Stop(
      `No canvas ${shown(file)}. Start one with: node ${SCRIPT} new <name>, or give the path to one that exists.`,
    );
  return file;
}

/** A canvas written over whole has lost its frame, and every way of fixing it by hand. */
const rewritten = (file) =>
  new Stop(
    `${shown(file)} has lost the canvas around its boards — it was written over whole. Start a new one (node ${SCRIPT} new <another name>) and put the boards into it (node ${SCRIPT} put <that name> <file>): put writes only the boards, never the rest.`,
  );

/** The boards and notes in `from` in place of the canvas's own, and nothing else touched. */
function putBoards(name, from) {
  const file = canvasAt(name);
  if (!from || !existsSync(from))
    throw new Stop(
      `Give the file the boards are written in: node ${SCRIPT} put ${name ?? "<name>"} <file>`,
    );
  const boards = readFileSync(from, "utf8");
  const why = notInside(boards);
  if (why)
    throw new Stop(
      `${from} ${why}: the boards and notes alone, one <article class="frame"> an option.`,
    );
  const count = boardSizes(boards).length;
  if (!count)
    throw new Stop(
      `${from} holds no board: one <article class="frame"> an option.`,
    );
  const canvas = readFileSync(file, "utf8");
  if (editedSince(canvas))
    throw new Stop(
      `${shown(file)} was changed since you last put it, and your file would undo that. Get its boards and notes as they are now (node ${SCRIPT} get ${name} <file>), make your change in that file, and put that.`,
    );
  const html = putBetween(canvas, boards);
  if (!html) throw rewritten(file);
  keep(file, html);
  console.log(
    `${count} board(s) in ${shown(file)}. Next: node ${SCRIPT} shots ${name}`,
  );
}

/** The canvas's boards and notes as they stand in it, into `to`, for a put that keeps what was changed. */
function getBoards(name, to) {
  const file = canvasAt(name);
  if (!to)
    throw new Stop(
      `Give the file to write the boards into: node ${SCRIPT} get ${name ?? "<name>"} <file>`,
    );
  const got = getBetween(readFileSync(file, "utf8"));
  if (!got) throw rewritten(file);
  writeFileSync(to, `${got.content}\n`);
  keep(file, got.html);
  console.log(
    `The boards and notes of ${shown(file)} as they are now are in ${to}. Change them there, then: node ${SCRIPT} put ${name} ${to}`,
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
  const file = canvasAt(name);
  const html = readFileSync(file, "utf8");
  // The canvas lays its boards flat for a picture with its own stylesheet: one without it
  // was written over whole
  if (!html.includes("body.shot")) throw rewritten(file);
  const sizes = boardSizes(html);
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
  writeFileSync(copy, html.replace(/<body(?=[\s>])/, '<body class="shot"'));
  for (const entry of readdirSync(dir, { withFileTypes: true }))
    if (entry.isFile() && join(dir, entry.name) !== file)
      copyFileSync(join(dir, entry.name), join(flat, entry.name));

  const sheet = join(dir, "boards.png");
  rmSync(sheet, { force: true });
  const done = spawnSync(
    process.execPath,
    // Never in the job's own browser, which may be a window on their screen
    [
      join(SKILLS, "artifact", "runtime", "render.mjs"),
      copy,
      "--out",
      dir,
      "--name",
      "board",
      "--apart",
      "--sheet",
      sheet,
    ],
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
    pathToFileURL(join(SKILLS, "browser", "scripts", "image-size.mjs")).href
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
    `The boards are pictures in ${shown(dir)}, and ${shown(sheet)} holds all of them for one look. Hand back the canvas and every board picture, so both are in front of whoever chooses.`,
  );
}

const commands = {
  new: newCanvas,
  put: putBoards,
  get: getBoards,
  shots: shotCanvas,
};
const [command, ...rest] = process.argv.slice(2);
try {
  if (!commands[command])
    throw new Stop(
      "Usage: canvas.mjs new <name> | put <name|path> <file> | get <name|path> <file> | shots <name|path>",
    );
  await commands[command](...rest);
} catch (error) {
  // A `Stop` is a line for the reader, not a stack
  if (!(error instanceof Stop)) throw error;
  console.error(error.message);
  process.exit(1);
}
