#!/usr/bin/env node
// A canvas of options: boards pinned on one pan/zoom surface in the bot's artifacts
// folder, and every board as a picture of its own.
//
//   node canvas.mjs new <name>                    the canvas, styled, to write boards into
//   node canvas.mjs shots <name> --size WxH       every board as a PNG beside it
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

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
const shown = (path) => relative(WORKSPACE, path) || ".";

class Stop extends Error {}

/** A canvas is a folder of its own: the page, and the pictures of its boards beside it. */
function canvasDir(name) {
  if (!name || !NAME.test(name))
    throw new Stop(
      `${name ? `"${name}" is not` : "Give"} a canvas name: letters, numbers, - and _ only.`,
    );
  return join(WORKSPACE, process.env.THURSDAY_ARTIFACTS || "artifacts", name);
}

const canvasFile = (name) => join(canvasDir(name), `${name}.html`);

function newCanvas(name) {
  const out = canvasFile(name);
  if (existsSync(out))
    throw new Stop(`${shown(out)} already exists. Edit it there.`);
  const part = (file) =>
    readFileSync(join(SKILL, "canvas", file), "utf8").trim();
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(
    out,
    part("canvas.html")
      .replaceAll("{{title}}", name)
      .replace("/* canvas.css */", () => part("canvas.css"))
      .replace("// canvas.js", () => part("canvas.js")),
  );
  console.log(
    `${shown(out)} is ready: one file that opens offline, and opens fitted. Write one <article class="frame"> per option with a <p class="note"> beside it (the comment inside says how), then run: node ${SCRIPT} shots ${name} --size WxH`,
  );
}

/**
 * The renderer shoots every `[data-slide]` at one exact size, and cannot see a board
 * the surface has scaled. So it is given a flat copy — the boards alone, at true size —
 * in a dot-folder the app's screens do not list, with whatever sits beside the page.
 */
function shotCanvas(name, args) {
  const file = canvasFile(name);
  if (!existsSync(file))
    throw new Stop(
      `No canvas ${shown(file)}. Start it with: node ${SCRIPT} new ${name}`,
    );
  const at = args.indexOf("--size");
  const size = at === -1 ? "" : (args[at + 1] ?? "");
  if (!/^\d+x\d+$/.test(size))
    throw new Stop(
      "Give the board size every board was written at: --size 1280x800",
    );

  const dir = canvasDir(name);
  const flat = join(dir, ".shots");
  rmSync(flat, { recursive: true, force: true });
  mkdirSync(flat, { recursive: true });
  writeFileSync(
    join(flat, `${name}.html`),
    readFileSync(file, "utf8").replace("<body>", '<body class="shot">'),
  );
  // Pictures a board points at sit beside the page, so they must sit beside the copy too
  for (const entry of readdirSync(dir, { withFileTypes: true }))
    if (entry.isFile() && entry.name !== `${name}.html`)
      copyFileSync(join(dir, entry.name), join(flat, entry.name));

  const render = join(
    process.env.THURSDAY_SKILLS || join(WORKSPACE, ".agents", "skills"),
    "browser",
    "scripts",
    "render.mjs",
  );
  const done = spawnSync(
    process.execPath,
    [
      render,
      join(flat, `${name}.html`),
      "--size",
      size,
      "--out",
      dir,
      "--name",
      "board",
    ],
    { stdio: "inherit" },
  );
  rmSync(flat, { recursive: true, force: true });
  // The renderer has already named what went wrong — a board that is not `size`, or no browser
  if (done.status !== 0)
    throw new Stop("Fix what it names above, then run this again.");
  console.log(
    `The boards are pictures in ${shown(dir)}. Hand back the canvas and every board picture, so both are in front of whoever chooses.`,
  );
}

const [command, ...rest] = process.argv.slice(2);
try {
  if (command === "new") newCanvas(rest[0]);
  else if (command === "shots") shotCanvas(rest[0], rest.slice(1));
  else throw new Stop("Usage: canvas.mjs new <name> | shots <name> --size WxH");
} catch (error) {
  if (!(error instanceof Stop)) throw error;
  console.error(error.message);
  process.exit(1);
}
