#!/usr/bin/env node
// A deck: slides of one exact size in one HTML file in the bot's artifacts folder, shown
// one at a time and scaled to the window, and every slide as a picture of its own.
//
//   node deck.mjs new <name> [--size WxH]    the deck, styled, to write slides into (1920x1080)
//   node deck.mjs shots <name>               every slide as a PNG beside it
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  fileFor,
  run,
  SKILL,
  Stop,
  shoot,
  shown,
  writeFromTemplate,
} from "./shots.mjs";

const SCRIPT = join(SKILL, "scripts", "deck.mjs");

function newDeck(name, ...args) {
  const at = args.indexOf("--size");
  const size = at === -1 ? "1920x1080" : (args[at + 1] ?? "");
  if (!/^\d+x\d+$/.test(size))
    throw new Stop("A size is width x height in px: --size 1920x1080");
  const [w, h] = size.split("x");
  const out = fileFor(name, "deck");
  writeFromTemplate(out, "deck", (html) =>
    html
      .replaceAll("{{title}}", name)
      .replaceAll("{{w}}", w)
      .replaceAll("{{h}}", h)
      // A printed page is one slide: `@page` takes no custom property, so it is written in
      .replace("/* page size */", `@page { size: ${w}px ${h}px; }`),
  );
  console.log(
    `${shown(out)} is ready: one file that opens offline, every slide ${size}. Write one <section data-slide> per slide (the comment inside says how), then run: node ${SCRIPT} shots ${name}`,
  );
}

function shotDeck(name) {
  const file = fileFor(name, "deck");
  if (!existsSync(file))
    throw new Stop(
      `No deck ${shown(file)}. Start it with: node ${SCRIPT} new ${name}`,
    );
  // The deck says its own size, where `new` wrote it
  const said = readFileSync(file, "utf8").match(
    /<body style="--w: (\d+); --h: (\d+)"/,
  );
  if (!said)
    throw new Stop(
      `${shown(file)} no longer says its size: keep <body style="--w: …; --h: …"> as it was written.`,
    );
  shoot(file, `${said[1]}x${said[2]}`, "slide");
  console.log(
    `The slides are pictures in ${shown(dirname(file))}. Hand back the deck, and the pictures when they are what should be looked at first.`,
  );
}

run(
  { new: newDeck, shots: shotDeck },
  "deck.mjs new <name> [--size WxH] | shots <name>",
);
