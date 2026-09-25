#!/usr/bin/env node
// A document to read, as one HTML file in the bot's artifacts folder: the document's
// stylesheet and script inlined, its body written in Markdown (or HTML) and put into it,
// its head the shell every page the app makes wears. No build, no install.
//
//   node document.mjs new <name> [--from <kind>]
//                                   the document, styled, laid out as a ready kind
//                                   (runtime/document/pages: report, memo, comparison,
//                                   plan, notes) or blank; `quick` is the same command
//   node document.mjs put <name|path> <file.md|file.html>
//                                   the body written in <file> into that document: Markdown
//                                   is turned into the document's own markup
//   node document.mjs get <name|path> <file>
//                                   the body as it is now, as HTML, into <file> to change
//   node document.mjs shots <name|path>
//                                   the page as it opens, down to three pictures in scratch/
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { documentBody } from "../runtime/document/markdown.mjs";
import {
  editedSince,
  getBetween,
  keep,
  notInside,
  putBetween,
} from "../runtime/shell/put.mjs";
import { retitle, wear } from "../runtime/shell/wear.mjs";
import {
  ARTIFACTS,
  NAME,
  Stop,
  shown,
  WORKSPACE,
} from "../runtime/shell/workspace.mjs";

const SKILL = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT = join(SKILL, "scripts", "document.mjs");

/**
 * A page with nothing to build: one HTML file in the bot's artifacts folder, the quick
 * stylesheet and script inlined, its body a ready document (`--from`) or blank until a
 * body is put into it. No kit is installed for it. Returns the file it wrote.
 */
function makePage(name, ...args) {
  if (!name || !NAME.test(name))
    throw new Stop(
      `${name ? `"${name}" is not` : "Give"} a page name: letters, numbers, - and _ only.`,
    );
  const quick = join(SKILL, "runtime", "document");
  const kinds = readdirSync(join(quick, "pages"))
    .filter((file) => file.endsWith(".html"))
    .map((file) => file.slice(0, -5));
  const at = args.indexOf("--from");
  const kind = at === -1 ? "blank" : (args[at + 1] ?? "");
  if (!kinds.includes(kind))
    throw new Stop(
      `No ready document "${kind}": --from takes one of ${kinds.filter((k) => k !== "blank").join(", ")}.`,
    );
  const out = join(ARTIFACTS, `${name}.html`);
  if (existsSync(out))
    throw new Stop(`${shown(out)} already exists. Edit it there.`);
  const part = (path) => readFileSync(join(quick, path), "utf8").trim();
  // A ready document is dated: today, so a date left as it came is at least the right one
  const today = new Date().toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(
    out,
    wear(
      part("quick.html")
        .replace("{{body}}", () => part(join("pages", `${kind}.html`)))
        .replace("{{css}}", () => part("quick.css"))
        .replace("{{js}}", () => part("quick.js"))
        .replaceAll("{{title}}", name)
        .replaceAll("{{today}}", today),
    ),
  );
  return { out, kind };
}

function newPage(name, ...args) {
  const { out, kind } = makePage(name, ...args);
  console.log(
    `${shown(out)} is ready: one file that opens offline, styled already${kind === "blank" ? "" : `, laid out as a ${kind}`}. Write its body in Markdown in a file of your own${kind === "blank" ? "" : `, starting from ${join(SKILL, "templates", "document", `${kind}.md`)}`}, then run: node ${SCRIPT} put ${name} <that file.md> — and hand back this path.`,
  );
}

/** A page in the bot's artifacts folder by name, or any page by its path. */
function pageAt(arg) {
  if (!arg) throw new Stop("Give a page name, or the path to one.");
  const file =
    !arg.includes("/") && !arg.endsWith(".html")
      ? join(ARTIFACTS, `${arg}.html`)
      : resolve(arg);
  if (!existsSync(file))
    throw new Stop(
      `No page ${shown(file)}. Start one with: node ${SCRIPT} new <name>, or give the path to one that exists.`,
    );
  return file;
}

/**
 * What a document calls itself: the words of its first heading, tags taken out. The file
 * is named for the page before its body is written, and a tab reading the file's name
 * for a title reads as unfinished.
 */
function headingOf(body) {
  const h1 = /<h1\b[^>]*>([\s\S]*?)<\/h1>/i.exec(body)?.[1] ?? "";
  return h1
    .replace(/<[^>]*>/g, "")
    .replace(
      /&(amp|lt|gt|quot|#39);/g,
      (_, e) => ({ amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'" })[e],
    )
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * The body written in `from` in place of the document's own, and nothing else of it touched.
 * A name with no document yet makes one first, so writing Markdown and putting it is the
 * whole of a new document.
 */
function putBody(name, from) {
  if (!from || !existsSync(from))
    throw new Stop(
      `Give the file the body is written in: node ${SCRIPT} put ${name ?? "<name>"} <file.md>`,
    );
  const fresh =
    name && NAME.test(name) && !existsSync(join(ARTIFACTS, `${name}.html`));
  if (fresh) makePage(name);
  const file = pageAt(name);
  const written = readFileSync(from, "utf8");
  const body = /\.(md|markdown)$/i.test(from) ? documentBody(written) : written;
  const why = notInside(body);
  if (why) throw new Stop(`${from} ${why}: the document's body alone.`);
  const page = readFileSync(file, "utf8");
  if (editedSince(page))
    throw new Stop(
      `${shown(file)} was edited since you last put it — in the app, or by hand — and your file would undo that. Get it as it is now (node ${SCRIPT} get ${name} <file>), make your change in that file, and put that.`,
    );
  const put = putBetween(page, body);
  if (!put) throw unmarked(file);
  const title = headingOf(body);
  const html = title ? retitle(put, title) : put;
  keep(file, html);
  console.log(
    `The body is in ${shown(file)}. Hand back this path; to see it as it opens: node ${SCRIPT} shots ${name}`,
  );
}

/** The document's body as it stands in the page, into `to`, for a put that keeps what was edited. */
function getBody(name, to) {
  const file = pageAt(name);
  if (!to)
    throw new Stop(
      `Give the file to write the body into: node ${SCRIPT} get ${name ?? "<name>"} <file>`,
    );
  const got = getBetween(readFileSync(file, "utf8"));
  if (!got) throw unmarked(file);
  writeFileSync(to, `${got.content}\n`);
  keep(file, got.html);
  console.log(
    `The body of ${shown(file)} as it is now is in ${to}. Change it there, then: node ${SCRIPT} put ${name} ${to}`,
  );
}

/** A page with no marks has nowhere a body goes. */
const unmarked = (file) =>
  new Stop(
    `${shown(file)} has no place for a body: only a page made by \`new\` has one, and one written over whole has lost it. Start a new one (node ${SCRIPT} new <another name>) and put the body into it.`,
  );

/**
 * The page as it opens, at the width the app draws it, as pictures to look at before it is
 * handed back: down the page, three windows at most. They are for checking, not for the
 * reader, so they go in scratch/, never beside the page among the finished work.
 */
function shotPage(name) {
  const file = pageAt(name);
  const out = join(WORKSPACE, "scratch", `${basename(file, ".html")}-shots`);
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  const skills = process.env.THURSDAY_SKILLS || resolve(SKILL, "..");
  const done = spawnSync(
    process.execPath,
    [
      join(skills, "artifact", "runtime", "render.mjs"),
      file,
      "--out",
      out,
      "--size",
      "1024x1400",
      "--most",
      "3",
      "--name",
      "page",
      // Never in the job's own browser, which may be a window on their screen
      "--apart",
    ],
    { stdio: "inherit" },
  );
  if (done.status !== 0)
    throw new Stop("Fix what it names above, then run this again.");
  console.log(`Look at them with look_at, from ${shown(out)}.`);
}

const [command, ...rest] = process.argv.slice(2);
try {
  if (command === "new" || command === "quick") newPage(...rest);
  else if (command === "put") putBody(...rest);
  else if (command === "get") getBody(...rest);
  else if (command === "shots") shotPage(rest[0]);
  else
    throw new Stop(
      "Usage: document.mjs new <name> [--from <kind>] | put <name|path> <file.md|file.html> | get <name|path> <file> | shots <name|path>",
    );
} catch (error) {
  if (!(error instanceof Stop)) throw error;
  console.error(error.message);
  process.exitCode = 1;
}
