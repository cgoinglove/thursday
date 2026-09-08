#!/usr/bin/env node
/**
 * Checks a skill the way the app checks it.
 *
 * The point is not style. `discoverSkills` skips what it cannot read —
 * quietly, by design, so that one bad folder does not take the whole list
 * down. Which means a skill with broken frontmatter does not fail loudly. It
 * just stops existing. This script turns that silence into a message.
 *
 * It imports the app's own yaml parser instead of writing a second one
 * (resolved relative to this file, so the project's node_modules) — a second
 * parser eventually disagrees with the first, and that disagreement looks
 * exactly like a skill that works here and vanishes there.
 *
 * Usage: node <this file> <skill-dir>
 */
import { readdir, readFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";

const SKILLS_ROOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const DIRS = [join(SKILLS_ROOT, "custom"), join(SKILLS_ROOT, "default")];

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

let raw;
try {
  raw = await readFile(join(dir, "SKILL.md"), "utf8");
} catch {
  console.error(`✗ no SKILL.md in ${dir}`);
  console.error(
    "  A skill is a directory with a SKILL.md in it. Nothing else counts.",
  );
  process.exit(1);
}

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
if (!front || typeof front !== "object") {
  console.error("✗ frontmatter must be key: value pairs");
  process.exit(1);
}
ok.push("frontmatter parses");

const { name, description } = front;

if (typeof name !== "string" || !name.trim()) {
  errors.push("name is missing — it is what the model passes to load_skill");
} else {
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(name)) {
    errors.push(
      `name '${name}' must be kebab-case: lowercase, digits, single hyphens`,
    );
  }
  if (name.length > 64)
    errors.push(`name is ${name.length} chars, keep it under 64`);
  if (name !== folder) {
    warnings.push(
      `name '${name}' does not match the folder '${folder}' — it still loads, but the model is told one and every path you give it says the other`,
    );
  }
  if (!errors.length) ok.push(`name '${name}'`);
}

if (typeof description !== "string" || !description.trim()) {
  errors.push(
    "description is missing — it is the only thing the model sees until the skill is loaded, and the only reason it would load it",
  );
} else {
  if (description.length > 1024) {
    errors.push(
      `description is ${description.length} chars, the limit is 1024`,
    );
  }
  if (description.length < 60) {
    warnings.push(
      "description is short — it has to say what the skill does AND when to reach for it, or it will not trigger",
    );
  }
  if (description.includes("<") || description.includes(">")) {
    warnings.push(
      "description contains < or >, which some hosts reject — drop them for portability",
    );
  }
  if (!errors.length) ok.push("description present");
}

// On a collision the earlier directory wins, so a name claimed under custom
// shadows the same name under default. That is how overriding works, and it
// is only a bug when it was not intended.
if (typeof name === "string" && name) {
  const owners = [];
  for (const root of DIRS) {
    let entries = [];
    try {
      entries = await readdir(root, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const other = join(root, entry.name);
      if (other === dir) {
        owners.push(other);
        continue;
      }
      try {
        const body = await readFile(join(other, "SKILL.md"), "utf8");
        const head = body.match(/^---\r?\n([\s\S]*?)\r?\n---/);
        if (head && parse(head[1])?.name === name) owners.push(other);
      } catch {}
    }
  }
  if (owners.length > 1) {
    const winner = owners[0];
    const line =
      winner === dir ? "this one wins" : `'${winner}' wins, this one is dead`;
    warnings.push(
      `name '${name}' is claimed by ${owners.length} folders — ${line}`,
    );
  }
}

const bodyLines = raw.slice(match[0].length).split("\n").length;
if (bodyLines > 500) {
  warnings.push(
    `body is ${bodyLines} lines — it is read in full every time the skill loads. Move the detail into references/ and point at it`,
  );
}

if (!dir.startsWith(join(SKILLS_ROOT, "custom"))) {
  warnings.push(
    `this is not under ${join(SKILLS_ROOT, "custom")} — new skills belong there. skills/default ships with the app`,
  );
}

for (const line of ok) console.log(`✓ ${line}`);
for (const line of warnings) console.log(`! ${line}`);
for (const line of errors) console.log(`✗ ${line}`);

if (errors.length) {
  console.log(
    `\n${errors.length} error(s) — the app cannot list this skill as written.`,
  );
  process.exit(1);
}
console.log(
  `\nValid. It will appear in the skill list the next time a call opens.`,
);
