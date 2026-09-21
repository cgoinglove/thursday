#!/usr/bin/env node
// A canvas of options: boards pinned on one pan/zoom surface in the bot's artifacts
// folder, and every board as a picture of its own.
//
//   node canvas.mjs new <name>                    the canvas, styled, to write boards into
//   node canvas.mjs shots <name> --size WxH       every board as a PNG beside it
import { existsSync } from "node:fs";
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

const SCRIPT = join(SKILL, "scripts", "canvas.mjs");

function newCanvas(name) {
  const out = fileFor(name, "canvas");
  writeFromTemplate(out, "canvas", (html) =>
    html.replaceAll("{{title}}", name),
  );
  console.log(
    `${shown(out)} is ready: one file that opens offline, and opens fitted. Write one <article class="frame"> per option with a <p class="note"> beside it (the comment inside says how), then run: node ${SCRIPT} shots ${name} --size WxH`,
  );
}

function shotCanvas(name, ...args) {
  const file = fileFor(name, "canvas");
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
  shoot(file, size, "board");
  console.log(
    `The boards are pictures in ${shown(dirname(file))}. Hand back the canvas and every board picture, so both are in front of whoever chooses.`,
  );
}

run(
  { new: newCanvas, shots: shotCanvas },
  "canvas.mjs new <name> | shots <name> --size WxH",
);
