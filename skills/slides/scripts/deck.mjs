#!/usr/bin/env node
// A deck: slides of one exact size in one HTML file in the bot's artifacts folder, shown
// one at a time and scaled to the window, and every slide as a picture of its own.
//
//   node deck.mjs new <name> [--size WxH]    the deck, styled, to write slides into (1920x1080)
//   node deck.mjs put <name|path> <file>     the slides written in <file>, into the deck
//   node deck.mjs shots <name|path>          every slide as a PNG beside it
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
import { fileURLToPath } from "node:url";
import { notInside, putBetween } from "../../shell/put.mjs";
import { wear } from "../../shell/wear.mjs";

const SKILL = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT = join(SKILL, "scripts", "deck.mjs");
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
/** A path as the reader should type it: short from the workspace, whole from outside it. */
const shown = (path) => {
  const near = relative(WORKSPACE, path);
  if (!near) return ".";
  return near.startsWith("..") ? path : near;
};

class Stop extends Error {}

/** `<name>/<name>.html` in the bot's artifacts folder: the deck, with its pictures beside it. */
function fileFor(name) {
  if (!name || !NAME.test(name))
    throw new Stop(
      `${name ? `"${name}" is not` : "Give"} a deck name: letters, numbers, - and _ only.`,
    );
  return join(
    WORKSPACE,
    process.env.THURSDAY_ARTIFACTS || "artifacts",
    name,
    `${name}.html`,
  );
}

/**
 * What `shots` was pointed at. A name is this bot's own deck. A path — the file, or the
 * folder holding it — is how a deck another bot made is shot: work handed over lands in
 * the folder of whoever it was handed to, which no name of mine reaches.
 */
function sourceFor(arg) {
  if (!arg) throw new Stop("Give a deck name, or the path to one.");
  if (!arg.includes("/") && !arg.endsWith(".html")) return fileFor(arg);
  const path = resolve(arg);
  return existsSync(path) && statSync(path).isDirectory()
    ? join(path, `${basename(path)}.html`)
    : path;
}

function newDeck(name, ...args) {
  const at = args.indexOf("--size");
  const size = at === -1 ? "1920x1080" : (args[at + 1] ?? "");
  if (!/^\d+x\d+$/.test(size))
    throw new Stop("A size is width x height in px: --size 1920x1080");
  const [w, h] = size.split("x");
  const out = fileFor(name);
  if (existsSync(out))
    throw new Stop(`${shown(out)} already exists. Edit it there.`);
  const part = (ext) =>
    readFileSync(join(SKILL, "deck", `deck.${ext}`), "utf8").trim();
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(
    out,
    wear(
      part("html")
        .replaceAll("{{title}}", name)
        .replaceAll("{{w}}", w)
        .replaceAll("{{h}}", h)
        // A printed page is one slide: `@page` takes no custom property, so it is written in
        .replace("/* page size */", `@page { size: ${w}px ${h}px; }`)
        .replace("/* deck.css */", () => part("css"))
        .replace("// deck.js", () => part("js")),
    ),
  );
  console.log(
    `${shown(out)} is ready: one file that opens offline, every slide ${size}. Copy a slide from ${join(SKILL, "deck", "slides")} for each step into a file of your own and change the words (the comment inside the deck says how), then run: node ${SCRIPT} put ${name} <that file> && node ${SCRIPT} shots ${name}`,
  );
}

/** A deck that exists, named or pointed at. */
function deckAt(arg) {
  const file = sourceFor(arg);
  if (!existsSync(file))
    throw new Stop(
      `No deck ${shown(file)}. Start one with: node ${SCRIPT} new <name>, or give the path to one that exists.`,
    );
  return file;
}

/** A deck written over whole has lost its frame, and every way of fixing it by hand. */
const rewritten = (file) =>
  new Stop(
    `${shown(file)} has lost the deck around its slides — it was written over whole. Start a new one (node ${SCRIPT} new <another name>) and put the slides into it (node ${SCRIPT} put <that name> <file>): put writes only the slides, never the rest.`,
  );

/** The slides in `from` in place of the deck's own, and nothing else of it touched. */
function putSlides(name, from) {
  const file = deckAt(name);
  if (!from || !existsSync(from))
    throw new Stop(
      `Give the file the slides are written in: node ${SCRIPT} put ${name ?? "<name>"} <file>`,
    );
  const slides = readFileSync(from, "utf8");
  const why = notInside(slides);
  if (why)
    throw new Stop(
      `${from} ${why}: the slides alone, one <section data-slide> each.`,
    );
  if (!/<section\b[^>]*\bdata-slide\b/.test(slides))
    throw new Stop(`${from} holds no slide: one <section data-slide> each.`);
  const html = putBetween(readFileSync(file, "utf8"), slides);
  if (!html) throw rewritten(file);
  writeFileSync(file, html);
  const count = slides.match(/<section\b[^>]*\bdata-slide\b/g).length;
  console.log(
    `${count} slide(s) in ${shown(file)}. Next: node ${SCRIPT} shots ${name}`,
  );
}

function shotDeck(name) {
  const file = deckAt(name);
  const html = readFileSync(file, "utf8");
  // The deck says its own size on its body, where `new` wrote it, and lays its slides flat
  // for a picture with its own stylesheet: a deck without both was written over whole
  const body = /<body\b[^>]*\bstyle="([^"]*)"/.exec(html)?.[1] ?? "";
  const w = /--w:\s*(\d+)/.exec(body)?.[1];
  const h = /--h:\s*(\d+)/.exec(body)?.[1];
  if (!w || !h || !html.includes("body.shot")) throw rewritten(file);

  // The renderer shoots every `[data-slide]` at one exact size, and cannot see a slide the
  // deck has scaled to fit the window. So it is given a flat copy — the slides alone, at
  // true size — in a dot-folder the app's screens do not list, with whatever sits beside
  // the deck, since a picture a slide points at sits beside it.
  const dir = dirname(file);
  const flat = join(dir, ".shots");
  const copy = join(flat, file.slice(dir.length + 1));
  rmSync(flat, { recursive: true, force: true });
  mkdirSync(flat, { recursive: true });
  writeFileSync(copy, html.replace(/<body(?=[\s>])/, '<body class="shot"'));
  for (const entry of readdirSync(dir, { withFileTypes: true }))
    if (entry.isFile() && join(dir, entry.name) !== file)
      copyFileSync(join(dir, entry.name), join(flat, entry.name));

  const done = spawnSync(
    process.execPath,
    [
      join(SKILLS, "browser", "scripts", "render.mjs"),
      copy,
      "--size",
      `${w}x${h}`,
      "--out",
      dir,
      "--name",
      "slide",
      // Never in the job's own browser, which may be a window on their screen
      "--apart",
    ],
    { stdio: "inherit" },
  );
  rmSync(flat, { recursive: true, force: true });
  // The renderer has already named what went wrong — a slide that overflowed, no browser
  if (done.status !== 0)
    throw new Stop("Fix what it names above, then run this again.");
  console.log(
    `The slides are pictures in ${shown(dir)}. Hand back the deck, and the pictures when they are what should be looked at first.`,
  );
}

const commands = { new: newDeck, put: putSlides, shots: shotDeck };
const [command, ...rest] = process.argv.slice(2);
try {
  if (!commands[command])
    throw new Stop(
      "Usage: deck.mjs new <name> [--size WxH] | put <name|path> <file> | shots <name|path>",
    );
  commands[command](...rest);
} catch (error) {
  // A `Stop` is a line for the reader, not a stack
  if (!(error instanceof Stop)) throw error;
  console.error(error.message);
  process.exit(1);
}
