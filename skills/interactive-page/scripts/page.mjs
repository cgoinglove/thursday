#!/usr/bin/env node
// A page to read, as one hand-written HTML file in the bot's artifacts folder: the quick
// stylesheet and script inlined, its body a ready document or blank. No build, no install.
//
//   node page.mjs quick <name> [--from <kind>]
//                                   the page, styled, from a ready document (quick/pages:
//                                   report, memo, comparison, plan, notes) or blank
//   node page.mjs put <name|path> <file>
//                                   the document's body written in <file>, into that page
//   node page.mjs get <name|path> <file>
//                                   the document's body as it is now, into <file> to change
//   node page.mjs shots <name|path> the page as it opens, down to three pictures in scratch/
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  editedSince,
  getBetween,
  keep,
  notInside,
  putBetween,
} from "../../shell/put.mjs";
import { wear } from "../../shell/wear.mjs";

const SKILL = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT = join(SKILL, "scripts", "page.mjs");

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

const NAME = /^[\p{L}\p{N}][\p{L}\p{N}_-]{0,79}$/u;
/**
 * A page with nothing to build: one HTML file in the bot's artifacts folder, the quick
 * stylesheet and script inlined, its body a ready document (`--from`) or blank, written
 * by hand from there. No kit is installed for it.
 */
function quickPage(name, ...args) {
  if (!name || !NAME.test(name))
    throw new Stop(
      `${name ? `"${name}" is not` : "Give"} a page name: letters, numbers, - and _ only.`,
    );
  const quick = join(SKILL, "quick");
  const kinds = readdirSync(join(quick, "pages"))
    .filter((file) => file.endsWith(".html"))
    .map((file) => file.slice(0, -5));
  const at = args.indexOf("--from");
  const kind = at === -1 ? "blank" : (args[at + 1] ?? "");
  if (!kinds.includes(kind))
    throw new Stop(
      `No ready document "${kind}": --from takes one of ${kinds.filter((k) => k !== "blank").join(", ")}.`,
    );
  const out = join(
    WORKSPACE,
    process.env.THURSDAY_ARTIFACTS || "artifacts",
    `${name}.html`,
  );
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
  console.log(
    `${shown(out)} is ready: one file that opens offline, styled already${kind === "blank" ? "" : `, laid out as a ${kind}`}. Write its body in plain HTML in a file of your own from what is there (the comment inside says what each part is for), then run: node ${SCRIPT} put ${name} <that file> && node ${SCRIPT} shots ${name} — and hand back this path.`,
  );
}

/** A page in the bot's artifacts folder by name, or any page by its path. */
function pageAt(arg) {
  if (!arg) throw new Stop("Give a page name, or the path to one.");
  const file =
    !arg.includes("/") && !arg.endsWith(".html")
      ? join(
          WORKSPACE,
          process.env.THURSDAY_ARTIFACTS || "artifacts",
          `${arg}.html`,
        )
      : resolve(arg);
  if (!existsSync(file))
    throw new Stop(
      `No page ${shown(file)}. Start one with: node ${SCRIPT} quick <name>, or give the path to one that exists.`,
    );
  return file;
}

/** The body written in `from` in place of the document's own, and nothing else of it touched. */
function putBody(name, from) {
  const file = pageAt(name);
  if (!from || !existsSync(from))
    throw new Stop(
      `Give the file the body is written in: node ${SCRIPT} put ${name ?? "<name>"} <file>`,
    );
  const body = readFileSync(from, "utf8");
  const why = notInside(body);
  if (why) throw new Stop(`${from} ${why}: the document's body alone.`);
  const page = readFileSync(file, "utf8");
  if (editedSince(page))
    throw new Stop(
      `${shown(file)} was edited since you last put it — in the app, or by hand — and your file would undo that. Get it as it is now (node ${SCRIPT} get ${name} <file>), make your change in that file, and put that.`,
    );
  const html = putBetween(page, body);
  if (!html) throw unmarked(file);
  keep(file, html);
  console.log(
    `The body is in ${shown(file)}. Next: node ${SCRIPT} shots ${name}`,
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
    `${shown(file)} has no place for a body: only a page made by \`quick\` has one, and one written over whole has lost it. Start a new one (node ${SCRIPT} quick <another name>) and put the body into it.`,
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
      join(skills, "browser", "scripts", "render.mjs"),
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
  if (command === "quick") quickPage(...rest);
  else if (command === "put") putBody(...rest);
  else if (command === "get") getBody(...rest);
  else if (command === "shots") shotPage(rest[0]);
  else
    throw new Stop(
      "Usage: page.mjs quick <name> [--from <kind>] | put <name|path> <file> | get <name|path> <file> | shots <name|path>",
    );
} catch (error) {
  if (!(error instanceof Stop)) throw error;
  console.error(error.message);
  process.exitCode = 1;
}
