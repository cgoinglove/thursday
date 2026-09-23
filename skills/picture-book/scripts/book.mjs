#!/usr/bin/env node
// A picture book: one HTML file in a folder of its own, printed and read aloud.
//
//   node book.mjs new <name>                               the book, styled, to write pages into
//   node book.mjs pdf <name>                               the book as a PDF, one page a sheet
//   node book.mjs video <name> <audio>... [--size WxH]     the book as an mp4, one audio file per page
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { bookPdf } from "./book-pdf.mjs";
import { bookVideo } from "./book-video.mjs";

const SKILL = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT = join(SKILL, "scripts", "book.mjs");
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

/**
 * Where a book lives: a folder of its own under the bot's artifacts, holding the
 * book and everything it is made of, so the finished book is one thing on screen.
 */
function bookFile(name) {
  if (!name || !NAME.test(name))
    throw new Stop(
      `${name ? `"${name}" is not` : "Give"} a book name: letters, numbers, - and _ only.`,
    );
  return join(
    WORKSPACE,
    process.env.THURSDAY_ARTIFACTS || "artifacts",
    name,
    `${name}.html`,
  );
}

/** An existing book, or how to start one. */
function openBook(name) {
  const book = bookFile(name);
  if (!existsSync(book))
    throw new Stop(
      `No book ${shown(book)}. Start it with: node ${SCRIPT} new ${name}`,
    );
  return book;
}

/** One HTML file with its stylesheet and page turning inlined, which the web, print and the video all read. */
function newBook(name) {
  const out = bookFile(name);
  if (existsSync(out))
    throw new Stop(`${shown(out)} already exists. Edit it there.`);
  const book = join(SKILL, "book");
  const part = (file) => readFileSync(join(book, file), "utf8").trim();
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(
    out,
    part("book.html")
      .replaceAll("{{title}}", name)
      .replace("/* book.css */", () => part("book.css"))
      .replace("// book.js", () => part("book.js")),
  );
  console.log(
    `${shown(out)} is ready: one file that opens offline, styled already. Write one <section class="page"> per page inside <main> (the comment inside says how), and hand back this path. Its pictures, its PDF and its video belong in the folder around it, ${shown(dirname(out))}, which is what the user sees as the book.`,
  );
}

function videoBook(name, args) {
  const book = openBook(name);
  const at = args.indexOf("--size");
  const size = at === -1 ? "1920x1080" : (args[at + 1] ?? "");
  const voices = args.filter((_, i) => at === -1 || (i !== at && i !== at + 1));
  bookVideo(
    {
      book,
      voices: voices.map((file) => resolve(WORKSPACE, file)),
      size,
      workspace: WORKSPACE,
      shown,
    },
    Stop,
  );
}

const [command, ...rest] = process.argv.slice(2);
try {
  if (command === "new") newBook(rest[0]);
  else if (command === "pdf")
    await bookPdf({ book: openBook(rest[0]), shown }, Stop);
  else if (command === "video") videoBook(rest[0], rest.slice(1));
  else
    throw new Stop(
      "Usage: book.mjs new <name> | pdf <name> | video <name> <audio>... [--size WxH]",
    );
} catch (error) {
  if (!(error instanceof Stop)) throw error;
  console.error(error.message);
  process.exit(1);
}
