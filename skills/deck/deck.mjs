#!/usr/bin/env node
// A deck: slides of one exact size in one HTML file that opens offline. The file holds the
// deck as data — its title, its theme and its slides, as JSON between the put marks — and
// draws the slides from it itself (deck.js). The app's deck tool (features/ai/tools/deck.tool)
// checks the deck and runs this; it answers in one line of JSON on stdout.
//
//   node deck.mjs put <file> <deck.json> [--revision <r>]
//       The deck into <file>, in the frame as it ships now: { "revision" }. A file that
//       names another revision than <r> — changed in the app, or written by a job that did
//       not see it — is left alone, exit 3: { "changed", "revision", "deck" }; so is a page
//       that holds no deck, its deck null.
//   node deck.mjs shots <file>
//       Every slide as slide-01.png… beside it: { "pictures", "cut" }, `cut` naming the
//       slides that came out taller or wider than a slide, which is what does not fit.
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
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { imageSize } from "../browser/scripts/image-size.mjs";
import { keep, putBetween } from "../shell/put.mjs";
import { retitle, wear } from "../shell/wear.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
// The shipped skills, where the browser skill's renderer takes the pictures
const SKILLS = process.env.THURSDAY_SKILLS || resolve(HERE, "..");
/** Every slide's size; the tool offers no other. */
const W = 1920;
const H = 1080;
const SHOT = /^slide-(\d+)\.png$/;

class Stop extends Error {}

const answer = (value) => console.log(JSON.stringify(value));

/**
 * The deck as it sits in the page: JSON that no `</script>` or `<!--` inside it can end,
 * in the script tag as a browser writes it back when the app keeps an edit.
 */
const inline = (deck) =>
  `<script type="application/json" data-deck="">${JSON.stringify(deck).replace(/</g, "\\u003c")}</script>`;

const revisionOf = (html) =>
  /<meta name="revision" content="([^"]*)">/.exec(html)?.[1] ?? "";

/** The deck a page holds as data, or null: one written by hand before decks were data. */
function deckIn(html) {
  const found =
    /<!-- put: start[^>]*-->\s*<script type="application\/json" data-deck(?:="")?>([\s\S]*?)<\/script>/.exec(
      html,
    );
  if (!found) return null;
  try {
    return JSON.parse(found[1]);
  } catch {
    return null;
  }
}

/** A new deck's frame: the head, the stage, the notes and the strip, with nothing on it yet. */
function frame() {
  const part = (ext) => readFileSync(join(HERE, `deck.${ext}`), "utf8").trim();
  return wear(
    part("html")
      .replaceAll("{{w}}", String(W))
      .replaceAll("{{h}}", String(H))
      // A printed page is one slide: `@page` takes no custom property, so it is written in
      .replace("/* page size */", `@page { size: ${W}px ${H}px; }`)
      .replace("/* deck.css */", () => part("css"))
      .replace("// deck.js", () => part("js")),
  );
}

function putDeck(file, from, ...args) {
  if (!file || !from) throw new Stop("Usage: deck.mjs put <file> <deck.json>");
  const at = args.indexOf("--revision");
  const seen = at === -1 ? "" : (args[at + 1] ?? "");
  const deck = JSON.parse(readFileSync(from, "utf8"));
  if (!Array.isArray(deck.slides)) throw new Stop(`${from} holds no slides.`);

  if (existsSync(file)) {
    const was = readFileSync(file, "utf8");
    const held = deckIn(was);
    // A page that holds no deck is never written over, whatever revision is named
    if (!held || seen !== revisionOf(was)) {
      answer({ changed: true, revision: revisionOf(was), deck: held });
      process.exit(3);
    }
    // A deck changed with no palette named keeps its own
    deck.theme ||= held.theme ?? null;
  }
  // The frame is written anew every time, so a deck made before an update draws with this
  // one: the file keeps nothing of its own but the deck
  const html = putBetween(frame(), inline(deck));
  mkdirSync(dirname(file), { recursive: true });
  keep(file, retitle(html, deck.title ?? ""));
  answer({ revision: revisionOf(html) });
}

function shotDeck(file) {
  if (!file || !existsSync(file)) throw new Stop(`No deck at ${file}.`);
  const html = readFileSync(file, "utf8");
  if (!html.includes("body.shot"))
    throw new Stop(`${file} is not a deck this can shoot.`);

  // Pictures of the slides the deck held before: fewer slides now leave some behind
  const dir = dirname(file);
  for (const name of readdirSync(dir))
    if (SHOT.test(name)) rmSync(join(dir, name), { force: true });

  // The renderer shoots every `[data-slide]` at one exact size, and cannot see a slide the
  // deck has scaled to fit the window. So it is given a flat copy — the slides alone, at
  // true size — in a dot-folder the app's screens do not list, with whatever sits beside
  // the deck, since a picture a slide shows sits beside it.
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
      `${W}x${H}`,
      "--out",
      dir,
      "--name",
      "slide",
      // Never in the job's own browser, which may be a window on their screen
      "--apart",
    ],
    { encoding: "utf8" },
  );
  rmSync(flat, { recursive: true, force: true });

  // What came out says what did not fit: a slide that overflows comes out taller
  const pictures = readdirSync(dir)
    .filter((name) => SHOT.test(name))
    .sort();
  if (!pictures.length)
    throw new Stop(
      (done.stderr || done.stdout || "").trim().split("\n").at(-1) ||
        "No pictures were made.",
    );
  const cut = pictures.flatMap((name) => {
    const size = imageSize(join(dir, name));
    return size && size.w === W && size.h === H
      ? []
      : [Number(SHOT.exec(name)[1])];
  });
  answer({ pictures: pictures.map((name) => join(dir, name)), cut });
}

const commands = { put: putDeck, shots: shotDeck };
const [command, ...rest] = process.argv.slice(2);
try {
  if (!commands[command])
    throw new Stop(
      "Usage: deck.mjs put <file> <deck.json> [--revision <r>] | shots <file>",
    );
  commands[command](...rest);
} catch (error) {
  // A `Stop` is a line for the caller, not a stack
  if (!(error instanceof Stop)) throw error;
  console.error(error.message);
  process.exit(1);
}
