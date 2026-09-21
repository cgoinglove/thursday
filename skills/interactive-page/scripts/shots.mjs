// What the canvas and the deck share: both are one HTML file in a folder of its own under
// the bot's artifacts, written from a template with its stylesheet and script inlined, and
// both hold parts of an exact size that the browser skill shoots to pictures beside the file.
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

export const SKILL = resolve(dirname(fileURLToPath(import.meta.url)), "..");
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
export const shown = (path) => relative(WORKSPACE, path) || ".";

export class Stop extends Error {}

/** `<name>/<name>.html` in the bot's artifacts folder: the page, with its pictures beside it. */
export function fileFor(name, what) {
  if (!name || !NAME.test(name))
    throw new Stop(
      `${name ? `"${name}" is not` : "Give"} a ${what} name: letters, numbers, - and _ only.`,
    );
  return join(
    WORKSPACE,
    process.env.THURSDAY_ARTIFACTS || "artifacts",
    name,
    `${name}.html`,
  );
}

/** Writes `out` from `<folder>/<stem>.html` with `<stem>.css` and `<stem>.js` inlined. */
export function writeFromTemplate(out, stem, fill = (html) => html) {
  if (existsSync(out))
    throw new Stop(`${shown(out)} already exists. Edit it there.`);
  const part = (ext) =>
    readFileSync(join(SKILL, stem, `${stem}.${ext}`), "utf8").trim();
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(
    out,
    fill(part("html"))
      .replace(`/* ${stem}.css */`, () => part("css"))
      .replace(`// ${stem}.js`, () => part("js")),
  );
}

/**
 * The renderer shoots every `[data-slide]` at one exact size, and cannot see a part the
 * page has scaled to fit the window. So it is given a flat copy — the parts alone, at true
 * size — in a dot-folder the app's screens do not list, with whatever sits beside the page.
 */
export function shoot(file, size, prefix) {
  const dir = dirname(file);
  const flat = join(dir, ".shots");
  const copy = join(flat, file.slice(dir.length + 1));
  rmSync(flat, { recursive: true, force: true });
  mkdirSync(flat, { recursive: true });
  writeFileSync(
    copy,
    readFileSync(file, "utf8").replace(/<body(?=[\s>])/, '<body class="shot"'),
  );
  // Pictures a part points at sit beside the page, so they must sit beside the copy too
  for (const entry of readdirSync(dir, { withFileTypes: true }))
    if (entry.isFile() && join(dir, entry.name) !== file)
      copyFileSync(join(dir, entry.name), join(flat, entry.name));

  const render = join(
    process.env.THURSDAY_SKILLS || join(WORKSPACE, ".agents", "skills"),
    "browser",
    "scripts",
    "render.mjs",
  );
  const done = spawnSync(
    process.execPath,
    [render, copy, "--size", size, "--out", dir, "--name", prefix],
    { stdio: "inherit" },
  );
  rmSync(flat, { recursive: true, force: true });
  // The renderer has already named what went wrong — a part that is not `size`, or no browser
  if (done.status !== 0)
    throw new Stop("Fix what it names above, then run this again.");
}

/** Runs one of `commands` by name; a `Stop` is a line for the reader, not a stack. */
export function run(commands, usage) {
  const [command, ...rest] = process.argv.slice(2);
  try {
    if (!commands[command]) throw new Stop(`Usage: ${usage}`);
    commands[command](...rest);
  } catch (error) {
    if (!(error instanceof Stop)) throw error;
    console.error(error.message);
    process.exit(1);
  }
}
