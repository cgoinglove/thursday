#!/usr/bin/env node
/**
 * Checks a skill the way the app reads it, and the way Anthropic's own
 * validator (skill-creator's quick_validate.py) rules it.
 *
 * The point is not style. `discoverSkills` skips what it cannot read —
 * quietly, by design, so that one bad folder does not take the whole list
 * down. Which means a skill with broken frontmatter does not fail loudly. It
 * just stops existing. This script turns that silence into a message.
 *
 * Past what the app needs, the rules are the Agent Skills spec's: a skill that
 * breaks them still loads here, but is refused on upload elsewhere (claude.ai,
 * the Skills API), which is how a skill the user meant to keep gets lost the day
 * it moves.
 *
 * It imports the app's own yaml parser instead of writing a second one
 * (resolved relative to this file, so the app's node_modules) — a second
 * parser eventually disagrees with the first, and that disagreement looks
 * exactly like a skill that works here and vanishes there. Nothing else: no
 * package to install, no Python.
 *
 * Usage: node <this file> <skill-dir>
 */
import { readdir, readFile } from "node:fs/promises";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";

/** The skills that ship with the app: this script sits in one of them. */
const SHIPPED = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

/** The spec's frontmatter keys; any other fails an upload outside this app. */
const ALLOWED = [
  "name",
  "description",
  "license",
  "compatibility",
  "metadata",
  "allowed-tools",
];

/** Keys the app once read at the top level, and where each belongs now. */
const MOVED = {
  platforms:
    "put it under metadata as `platforms: darwin` (the app reads it there)",
  disabled: "switching a skill off is Settings › Skills, not the file",
};

/** Reserved by Anthropic: a name holding either is refused there. */
const RESERVED = ["anthropic", "claude"];

/** The spec's limits, in characters (and the body's, in lines). */
const MAX = { name: 64, description: 1024, compatibility: 500, bodyLines: 500 };

/**
 * Folders whose SKILL.md is not a second skill: a package's, at any depth, and
 * test material at the root, as Anthropic's packager leaves them out.
 */
const SKIP_ANYWHERE = new Set(["node_modules", "__pycache__"]);
const SKIP_AT_ROOT = new Set(["evals"]);

const errors = [];
const warnings = [];
const ok = [];

const target = process.argv[2];
if (!target) {
  console.error("usage: node validate.mjs <skill-dir>");
  process.exit(1);
}

const dir = resolve(target);
const folder = basename(dir);

let entries;
try {
  entries = await readdir(dir);
} catch {
  console.error(`✗ ${dir} is not a folder`);
  process.exit(1);
}

// Exactly this name: macOS opens skill.md when asked for SKILL.md, Linux does not
if (!entries.includes("SKILL.md")) {
  const near = entries.find((entry) => entry.toLowerCase() === "skill.md");
  console.error(
    near
      ? `✗ ${near} must be named exactly SKILL.md — this Mac finds it anyway, other machines do not`
      : `✗ no SKILL.md in ${dir}\n  A skill is a directory with a SKILL.md in it. Nothing else counts.`,
  );
  process.exit(1);
}

const raw = await readFile(join(dir, "SKILL.md"), "utf8");

// The app's own regex. What this misses is a skill that does not exist.
const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
if (!match) {
  console.error(
    "✗ no frontmatter — SKILL.md must open with --- on line 1 and close with ---",
  );
  process.exit(1);
}

let front;
try {
  front = parse(match[1]);
} catch (error) {
  console.error(`✗ frontmatter is not valid yaml: ${error.message}`);
  process.exit(1);
}
if (!front || typeof front !== "object" || Array.isArray(front)) {
  console.error("✗ frontmatter must be key: value pairs");
  process.exit(1);
}
ok.push("frontmatter parses");

const unexpected = Object.keys(front).filter((key) => !ALLOWED.includes(key));
for (const key of unexpected) {
  errors.push(
    `unexpected key '${key}'${MOVED[key] ? ` — ${MOVED[key]}` : ""}. Allowed: ${ALLOWED.join(", ")}`,
  );
}

const { name, description, compatibility, metadata } = front;

if (typeof name !== "string" || !name.trim()) {
  errors.push("name is missing — it is what the model passes to load_skill");
} else {
  const named = name.trim();
  const before = errors.length;
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(named)) {
    errors.push(
      `name '${named}' must be kebab-case: lowercase letters, digits, single hyphens, no hyphen at either end`,
    );
  }
  if (named.length > MAX.name) {
    errors.push(`name is ${named.length} characters, the limit is ${MAX.name}`);
  }
  const reserved = RESERVED.filter((word) => named.includes(word));
  if (reserved.length) {
    errors.push(`name holds the reserved word '${reserved.join("', '")}'`);
  }
  if (named !== folder) {
    errors.push(
      `name '${named}' does not match the folder '${folder}' — the model is told one and every path it is given says the other`,
    );
  }
  if (errors.length === before) ok.push(`name '${named}'`);
}

if (typeof description !== "string" || !description.trim()) {
  errors.push(
    "description is missing — it is the only thing the model sees until the skill is loaded, and the only reason it would load it",
  );
} else {
  const said = description.trim();
  const before = errors.length;
  if (said.length > MAX.description) {
    errors.push(
      `description is ${said.length} characters, the limit is ${MAX.description}`,
    );
  }
  if (said.includes("<") || said.includes(">")) {
    errors.push(
      "description contains < or > — frontmatter goes into a system prompt, so angle brackets are refused",
    );
  }
  if (errors.length === before)
    ok.push(`description (${said.length} characters)`);
}

if (compatibility !== undefined && compatibility !== null) {
  if (typeof compatibility !== "string") {
    errors.push("compatibility must be text");
  } else if (compatibility.length > MAX.compatibility) {
    errors.push(
      `compatibility is ${compatibility.length} characters, the limit is ${MAX.compatibility}`,
    );
  }
}

// The app reads it as a map (skills.schema); anything else drops the skill from every list
if (
  metadata !== undefined &&
  (metadata === null || typeof metadata !== "object" || Array.isArray(metadata))
) {
  errors.push("metadata must be key: value pairs, indented under it");
}

// One SKILL.md per skill: an upload holding two is refused, and here the second is only a file
const skillFiles = [];
const walk = async (at, depth) => {
  let list;
  try {
    list = await readdir(at, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of list) {
    if (entry.isDirectory()) {
      if (SKIP_ANYWHERE.has(entry.name)) continue;
      if (depth === 0 && SKIP_AT_ROOT.has(entry.name)) continue;
      await walk(join(at, entry.name), depth + 1);
    } else if (entry.name === "SKILL.md") {
      skillFiles.push(relative(dir, join(at, entry.name)));
    }
  }
};
await walk(dir, 0);
const extra = skillFiles.filter((path) => path !== "SKILL.md");
if (extra.length) {
  errors.push(
    `a skill holds exactly one SKILL.md, at its root; also found ${extra.join(", ")}. Rename a supporting file (references/<topic>.md), or make each its own skill`,
  );
}

// On a collision the app's own skill wins and the other is not listed at all, so
// the shipped folder is read first, then the folder this skill sits in.
if (typeof name === "string" && name.trim()) {
  const owners = [];
  for (const root of new Set([SHIPPED, dirname(dir)])) {
    let rows = [];
    try {
      rows = await readdir(root, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const row of rows) {
      if (!row.isDirectory()) continue;
      const other = join(root, row.name);
      if (other === dir) {
        owners.push(other);
        continue;
      }
      try {
        const body = await readFile(join(other, "SKILL.md"), "utf8");
        const head = body.match(/^---\r?\n([\s\S]*?)\r?\n---/);
        if (head && parse(head[1])?.name === name.trim()) owners.push(other);
      } catch {}
    }
  }
  if (owners.length > 1) {
    const winner = owners[0];
    const line =
      winner === dir ? "this one wins" : `'${winner}' wins, this one is dead`;
    warnings.push(
      `name '${name.trim()}' is claimed by ${owners.length} folders — ${line}`,
    );
  }
}

const bodyLines = raw.slice(match[0].length).split("\n").length;
if (bodyLines > MAX.bodyLines) {
  warnings.push(
    `body is ${bodyLines} lines — it is read in full every time the skill loads. Move the detail into references/ and point at it`,
  );
}

// Where the app lists skills from: the shipped folder, and an .agents/skills folder
const parent = dirname(dir);
const listed =
  basename(parent) === "skills" && basename(dirname(parent)) === ".agents";
if (parent === SHIPPED) {
  warnings.push(
    `this is among the skills that ship with the app (${SHIPPED}) — a new skill belongs in an .agents/skills folder of the workspace`,
  );
} else if (!listed) {
  warnings.push(
    `the app lists skills only from an .agents/skills folder — the workspace's (every bot) or a bot's own (that bot alone); this one sits in ${parent}`,
  );
}

for (const line of ok) console.log(`✓ ${line}`);
for (const line of warnings) console.log(`! ${line}`);
for (const line of errors) console.log(`✗ ${line}`);

if (errors.length) {
  console.log(`\n${errors.length} error(s). Fix them and run this again.`);
  process.exit(1);
}
console.log(
  listed
    ? "\nValid. load_skill finds it by its name now; the skill lists show it from the next turn or call."
    : "\nValid.",
);
