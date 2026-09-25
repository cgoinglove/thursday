#!/usr/bin/env node
// A picture book: one HTML file in a folder of its own, printed and read aloud.
//
//   node book.mjs new <name>                               the book, styled, to write pages into
//   (a book after `new` is its name — its folder under your artifacts — or its path)
//   node book.mjs put <name> <pages.html> [--lang ko]      the pages written in <pages.html> put
//                                                          into the book, checked first
//   node book.mjs shots <name | path>                      every page as a picture, and all on one, in scratch/
//   node book.mjs pdf <name | path>                        the book as a PDF, one page a sheet
//   node book.mjs video <name> <audio>... [--size WxH]     the book as an mp4, one audio file per page
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { markSvg } from "../runtime/shell/wear.mjs";
import {
  ARTIFACTS,
  NAME,
  Stop,
  shown,
  WORKSPACE,
} from "../runtime/shell/workspace.mjs";
import { bookPdf } from "./book-pdf.mjs";
import { bookVideo } from "./book-video.mjs";

const SKILL = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT = join(SKILL, "scripts", "book.mjs");
const SKILLS = process.env.THURSDAY_SKILLS || resolve(SKILL, "..");

/**
 * Where a book lives: a folder of its own under the bot's artifacts, holding the
 * book and everything it is made of, so the finished book is one thing on screen.
 */
function bookFile(name) {
  if (!name || !NAME.test(name))
    throw new Stop(
      `${name ? `"${name}" is not` : "Give"} a book name: letters, numbers, - and _ only.`,
    );
  return join(ARTIFACTS, name, `${name}.html`);
}

/**
 * A book named, or pointed at by its folder or its file — a book another job made, or one
 * the path names as it was handed back. A path is taken as given; a name is looked for in
 * your own folder.
 */
function bookAt(arg) {
  if (!arg || !/[/\\]|\.html$/i.test(arg)) return bookFile(arg);
  const path = resolve(arg);
  if (/\.html$/i.test(path)) return path;
  return join(path, `${basename(path)}.html`);
}

/** An existing book, or how to start one. */
function openBook(name) {
  const book = bookAt(name);
  if (!existsSync(book))
    throw new Stop(
      `No book ${shown(book)}. A book is given by its name (its folder under your artifacts) or by its path; to start one: node ${SCRIPT} new <name>`,
    );
  return book;
}

/** Who is making the book, with their face (shell wear.mjs markSvg); nothing outside a bot's job. */
function maker() {
  const bot = process.env.THURSDAY_BOT?.trim();
  if (!bot) return "";
  const name = bot.replace(
    /[&<>"]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c],
  );
  return `<p class="maker" hidden>${markSvg(24)}${name}</p>`;
}

/** One HTML file with its stylesheet and page turning inlined, which the web, print and the video all read. */
function newBook(name) {
  const out = bookFile(name);
  if (existsSync(out))
    throw new Stop(`${shown(out)} already exists. Edit it there.`);
  const book = join(SKILL, "runtime", "book");
  const part = (file) => readFileSync(join(book, file), "utf8").trim();
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(
    out,
    part("book.html")
      .replaceAll("{{title}}", name)
      .replace("{{maker}}", () => maker())
      .replace("/* book.css */", () => part("book.css"))
      .replace("// book.js", () => part("book.js")),
  );
  console.log(
    `${shown(out)} is ready: one file that opens offline, styled already. Write its pages, one <section class="page"> each (references/book.md), in a file of your own, then: node ${SCRIPT} put ${name} <that file> — and hand back this path. Its pictures, its PDF and its video belong in the folder around it, ${shown(dirname(out))}, which is what the user sees as the book.`,
  );
}

/** Where the book's own <main> starts and ends: the last one opened before it closes. */
function mainOf(html) {
  const end = html.lastIndexOf("</main>");
  const start = html.lastIndexOf("<main>", end);
  if (start === -1 || end === -1) return null;
  return { start: start + "<main>".length, end };
}

/** The book's pages as they are, or a Stop when none has been written into it yet. */
function writtenBook(name) {
  const book = openBook(name);
  const html = readFileSync(book, "utf8");
  const at = mainOf(html);
  const pages = at ? html.slice(at.start, at.end) : "";
  // The pages `new` leaves: a cover named for the file and a page with nothing to read aloud
  if (!/<section\b/.test(pages) || /<section\b[^>]*data-say=""/.test(pages))
    throw new Stop(
      `${shown(book)} has no pages written into it yet${/data-say=""/.test(pages) ? " (a page in it has nothing in data-say)" : ""}. Write them in a file and put them: node ${SCRIPT} put ${name} <pages.html>.`,
    );
  return book;
}

/**
 * The pages in `from` checked and put into the book's <main>, in place of what it held; the
 * rest of the file — its style, its page turning, who made it — as it was. Every page is a
 * <section class="page"> with data-say; the first is the cover with an <h1>; a page is a
 * picture (<figure> with an <img> or an <svg>) and at most two <p>; a quiz page is its <h2>
 * question, two to four choices, one of them right, and an answer. A picture beside the book
 * must be there. What breaks one of these stops, naming the page.
 */
function putPages(name, from, args) {
  const book = openBook(name);
  if (!from || !existsSync(from))
    throw new Stop(
      `No file ${from ?? ""}. Write the pages in one and give it: node ${SCRIPT} put ${name} <pages.html>`,
    );
  const written = readFileSync(from, "utf8").replace(/<!--[\s\S]*?-->/g, "");
  const sections = written.match(/<section\b[^>]*>[\s\S]*?<\/section>/g) ?? [];
  const outside = written
    .replace(/<section\b[^>]*>[\s\S]*?<\/section>/g, "")
    .trim();
  if (outside)
    throw new Stop(
      `Only pages go in the file, each a <section class="page">…</section>; this is outside them: ${outside.slice(0, 120)}`,
    );
  if (sections.length < 2)
    throw new Stop(
      'A book is a cover and at least one page: two <section class="page"> at least.',
    );
  const folder = dirname(book);
  sections.forEach((section, i) => {
    const n = `Page ${i + 1}`;
    const open = /^<section\b[^>]*>/.exec(section)[0];
    const classes = /class="([^"]*)"/.exec(open)?.[1].split(/\s+/) ?? [];
    const count = (re) => (section.match(re) ?? []).length;
    if (!classes.includes("page"))
      throw new Stop(`${n} is not a <section class="page">.`);
    if (!/data-say="[^"]*\S[^"]*"/.test(open))
      throw new Stop(
        `${n} has no data-say: the sentence read aloud over it in the video.`,
      );
    if (count(/<svg\b/g) !== count(/<\/svg>/g))
      throw new Stop(`${n}: an <svg> in it is not closed.`);
    if (i === 0 && (!classes.includes("cover") || !/<h1\b/.test(section)))
      throw new Stop(
        `${n} is the cover: <section class="page cover" data-say="…"> with its picture and an <h1>.`,
      );
    if (classes.includes("quiz")) {
      const choices = /<ol class="choices">([\s\S]*?)<\/ol>/.exec(section)?.[1];
      const picks = (choices?.match(/<li\b/g) ?? []).length;
      if (!/<h2\b/.test(section) || !choices)
        throw new Stop(
          `${n} is a quiz: an <h2> question, then <ol class="choices"> of two to four <li><button>.`,
        );
      const buttons = choices.match(/<button\b[^>]*>/g) ?? [];
      if (buttons.length < 2 || buttons.length > 4 || picks !== buttons.length)
        throw new Stop(
          `${n}: a quiz has two to four choices, each an <li> holding one <button>; it has ${buttons.length}.`,
        );
      if (buttons.filter((b) => /\sdata-right\b/.test(b)).length !== 1)
        throw new Stop(`${n}: exactly one choice's <button> has data-right.`);
      if (!/<p class="answer">/.test(section))
        throw new Stop(`${n}: a quiz ends with <p class="answer"> saying why.`);
    } else if (i > 0) {
      if (!/<figure\b[\s\S]*?(<img\b|<svg\b)[\s\S]*?<\/figure>/.test(section))
        throw new Stop(
          `${n} has no picture: a <figure> with an <img> or an <svg> in it.`,
        );
      const lines = count(/<p\b/g);
      if (lines < 1 || lines > 2)
        throw new Stop(
          `${n} has ${lines} lines; a page has one or two <p> under its picture, and more is another page.`,
        );
    }
    for (const [, src] of section.matchAll(/<img\b[^>]*\ssrc="([^"]+)"/g))
      if (!/^(https?:|data:)/.test(src) && !existsSync(resolve(folder, src)))
        throw new Stop(
          `${n}: its picture ${src} is not in ${shown(folder)}; put the file there, or name it as it is.`,
        );
  });
  let html = readFileSync(book, "utf8");
  const at = mainOf(html);
  if (!at) throw new Stop(`${shown(book)} has no <main> to put pages in.`);
  html = `${html.slice(0, at.start)}\n${sections.map((s) => `      ${s.trim()}`).join("\n\n")}\n    ${html.slice(at.end)}`;
  const at2 = args.indexOf("--lang");
  if (at2 !== -1) {
    const lang = args[at2 + 1] ?? "";
    if (!/^[a-zA-Z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(lang))
      throw new Stop(`--lang takes a language code: ko, en, ja, pt-BR.`);
    html = html.replace(/<html\b[^>]*>/, `<html lang="${lang}">`);
  }
  writeFileSync(book, html);
  const quiz = sections.some((s) =>
    /^<section\b[^>]*class="[^"]*\bquiz\b/.test(s),
  );
  console.log(
    `Put ${sections.length} pages into ${shown(book)}${quiz ? ", a quiz among them" : ""}. Look at them once: node ${SCRIPT} shots ${name}`,
  );
}

/**
 * Every page as a picture at the size a screen shows it, and all of them on one, in
 * scratch/: a look at the book, never part of it, so never in the book's own folder.
 */
function shotBook(name) {
  const book = writtenBook(name);
  const out = join(WORKSPACE, "scratch", `${basename(book, ".html")}-shots`);
  const sheet = join(out, "book.png");
  rmSync(out, { recursive: true, force: true });
  const done = spawnSync(
    process.execPath,
    [
      join(SKILLS, "artifact", "runtime", "render.mjs"),
      book,
      "--size",
      "960x540",
      "--out",
      out,
      "--name",
      "page",
      // Never in the job's own browser, which may be a window on their screen
      "--apart",
      "--sheet",
      sheet,
    ],
    { encoding: "utf8" },
  );
  const said = `${done.stdout}${done.stderr}`.trim();
  if (done.status !== 0 || !existsSync(sheet))
    throw new Stop(said.split("\n").at(-1) || "No pictures were made.");
  const broken = /^Pictures that did not load.*$/m.exec(said);
  console.log(
    `${broken ? `${broken[0]}\n` : ""}Every page is on ${shown(sheet)}: look at it with look_at. One page alone is ${shown(out)}/page-01.png on.`,
  );
}

function videoBook(name, args) {
  const book = writtenBook(name);
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
  else if (command === "shots") shotBook(rest[0]);
  else if (command === "pdf")
    await bookPdf({ book: writtenBook(rest[0]), shown }, Stop);
  else if (command === "put") putPages(rest[0], rest[1], rest.slice(2));
  else if (command === "video") videoBook(rest[0], rest.slice(1));
  else
    throw new Stop(
      "Usage: book.mjs new <name> | put <name> <pages.html> [--lang ko] | shots <name> | pdf <name> | video <name> <audio>... [--size WxH]",
    );
} catch (error) {
  if (!(error instanceof Stop)) throw error;
  console.error(error.message);
  process.exit(1);
}
