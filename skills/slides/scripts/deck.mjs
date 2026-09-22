#!/usr/bin/env node
// A deck: slides of one exact size in one HTML file in the bot's artifacts folder, shown
// one at a time and scaled to the window, and every slide as a picture of its own.
//
//   node deck.mjs new <name> [--size WxH]    the deck, styled, to write slides into (1920x1080)
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
    part("html")
      .replaceAll("{{title}}", name)
      .replaceAll("{{w}}", w)
      .replaceAll("{{h}}", h)
      // A printed page is one slide: `@page` takes no custom property, so it is written in
      .replace("/* page size */", `@page { size: ${w}px ${h}px; }`)
      .replace("/* deck.css */", () => part("css"))
      .replace("// deck.js", () => part("js")),
  );
  console.log(
    `${shown(out)} is ready: one file that opens offline, every slide ${size}. Copy a slide from ${join(SKILL, "deck", "slides")} for each step and change the words (the comment inside says how), then run: node ${SCRIPT} shots ${name}`,
  );
}

function shotDeck(name) {
  const file = sourceFor(name);
  if (!existsSync(file))
    throw new Stop(
      `No deck ${shown(file)}. Start one with: node ${SCRIPT} new <name>, or give the path to one that exists.`,
    );
  // The deck says its own size, where `new` wrote it
  const said = readFileSync(file, "utf8").match(
    /<body style="--w: (\d+); --h: (\d+)"/,
  );
  if (!said)
    throw new Stop(
      `${shown(file)} no longer says its size: keep <body style="--w: …; --h: …"> as it was written.`,
    );

  // The renderer shoots every `[data-slide]` at one exact size, and cannot see a slide the
  // deck has scaled to fit the window. So it is given a flat copy — the slides alone, at
  // true size — in a dot-folder the app's screens do not list, with whatever sits beside
  // the deck, since a picture a slide points at sits beside it.
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

  const done = spawnSync(
    process.execPath,
    [
      join(SKILLS, "browser", "scripts", "render.mjs"),
      copy,
      "--size",
      `${said[1]}x${said[2]}`,
      "--out",
      dir,
      "--name",
      "slide",
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

const commands = { new: newDeck, shots: shotDeck };
const [command, ...rest] = process.argv.slice(2);
try {
  if (!commands[command])
    throw new Stop(
      "Usage: deck.mjs new <name> [--size WxH] | shots <name|path>",
    );
  commands[command](...rest);
} catch (error) {
  // A `Stop` is a line for the reader, not a stack
  if (!(error instanceof Stop)) throw error;
  console.error(error.message);
  process.exit(1);
}
