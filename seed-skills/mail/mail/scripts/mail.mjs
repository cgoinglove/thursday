#!/usr/bin/env node
// Mail by script, in the browser session this shell already has (PLAYWRIGHT_CLI_SESSION).
// Each command is one `playwright-cli run-code` call: the site's recipe runs inside that
// browser, rides its signed-in cookies, and hands back only the fields asked for.
//
//   node mail.mjs <site> list [query] [--max N] [--json]
//   node mail.mjs <site> unread [label] [--json]
//   node mail.mjs <site> read <id> <file> [--head N]
//   node mail.mjs <site> draft --to <a,b> [--cc <a>] [--subject <s>] (--body <text> | --body-file <f>)
//   node mail.mjs <site> reply <id> (--body <text> | --body-file <f>) [--all]
//
// <site> names a file in ../recipes (gmail). Nothing here sends, archives, deletes or labels.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const RECIPES = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "recipes",
);

function fail(message) {
  console.error(message);
  process.exit(1);
}

function parse(argv) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("--")) {
      positional.push(arg);
      continue;
    }
    const [key, inline] = arg.slice(2).split(/=(.*)/s);
    if (inline !== undefined) flags[key] = inline;
    else if (argv[i + 1] !== undefined && !argv[i + 1].startsWith("--"))
      flags[key] = argv[++i];
    else flags[key] = true;
  }
  return { positional, flags };
}

/**
 * Runs `step` from the recipe inside the browser. Every function in `recipe.steps` is
 * serialized with it, so a step reaches the others as `r.steps.<name>`; nothing else from
 * this file crosses over.
 */
function inBrowser(recipe, step, args) {
  // A method (`async list(page) {}`) prints as one; an arrow or a function needs its key.
  const method = /^(async\s+)?(?!function\b|async\b)[\w$]+\s*\(/;
  const steps = Object.entries(recipe.steps)
    .map(([name, fn]) =>
      method.test(fn.toString())
        ? fn.toString()
        : `${JSON.stringify(name)}: ${fn.toString()}`,
    )
    .join(",\n");
  const data = JSON.stringify({ ...recipe, steps: undefined });
  const code = `async page => {
    const r = ${data};
    r.steps = {${steps}};
    return r.steps[${JSON.stringify(step)}](page, ${JSON.stringify(args)}, r);
  }`;
  const ran = spawnSync("playwright-cli", ["--raw", "run-code", code], {
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
  });
  if (ran.error) fail(`playwright-cli did not run: ${ran.error.message}`);
  const out = `${ran.stdout ?? ""}${ran.stderr ?? ""}`.trim();
  if (ran.status !== 0) {
    if (/is not open/.test(out))
      fail(
        "No browser is open in this session. Run `playwright-cli open`, load the sign-in, and run this again.",
      );
    fail(out.replace(/^### Error\s*/, "").replace(/^Error:\s*/, ""));
  }
  if (!out) return null;
  try {
    return JSON.parse(out);
  } catch {
    fail(`Unexpected answer from the browser:\n${out.slice(0, 800)}`);
  }
}

const oneLine = (s, n) => {
  const t = String(s ?? "")
    .replace(/\s+/g, " ")
    .trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};

function printRows(rows, flags) {
  if (flags.json) {
    console.log(JSON.stringify(rows));
    return;
  }
  for (const m of rows) {
    const from = m.email ? `${m.from} <${m.email}>` : m.from;
    const count = m.count > 1 ? ` (${m.count})` : "";
    const snippet = m.snippet ? ` — ${oneLine(m.snippet, 120)}` : "";
    console.log(
      `${m.id} ${m.unread ? "*" : " "} ${m.date} | ${oneLine(from, 60)} | ${oneLine(m.subject, 90)}${count}${snippet}`,
    );
  }
}

function bodyOf(flags) {
  if (typeof flags["body-file"] === "string")
    return readFileSync(flags["body-file"], "utf8");
  if (typeof flags.body === "string") return flags.body.replace(/\\n/g, "\n");
  fail("Give the text with --body-file <file> (or --body for one short line).");
}

const [site, command, ...rest] = process.argv.slice(2);
if (!site || !command)
  fail(
    "Usage: mail.mjs <site> list|unread|read|draft|reply … — see the skill's SKILL.md.",
  );
const recipeFile = join(RECIPES, `${site}.mjs`);
if (!existsSync(recipeFile))
  fail(
    `No recipe for ${site} in ${RECIPES}. references/recipes.md says how to write one.`,
  );
const recipe = (await import(pathToFileURL(recipeFile).href)).default;
const { positional, flags } = parse(rest);

switch (command) {
  case "list": {
    const max = Number(flags.max ?? 20);
    const query = positional.join(" ") || recipe.defaultQuery;
    const found = inBrowser(recipe, "list", { query, max });
    if (!flags.json)
      console.log(
        `${found.rows.length} shown of ${found.total ?? "?"} for: ${query}   (* unread)`,
      );
    printRows(found.rows, flags);
    break;
  }
  case "unread": {
    const found = inBrowser(recipe, "unread", { label: positional[0] ?? "" });
    if (!flags.json)
      console.log(
        `${found.total} unread${positional[0] ? ` in ${positional[0]}` : ""}; the newest ${found.rows.length} below`,
      );
    printRows(found.rows, flags);
    break;
  }
  case "read": {
    const [id, file] = positional;
    if (!id || !file)
      fail("Usage: mail.mjs <site> read <id> <file> [--head N]");
    const thread = inBrowser(recipe, "read", { id });
    const lines = [`Subject: ${thread.subject}`, ""];
    for (const m of thread.messages) {
      lines.push(`From: ${m.from}`, `Date: ${m.date}`);
      if (m.to) lines.push(m.to);
      lines.push("", m.body.trim(), "");
      if (m.links.length)
        lines.push("Links:", ...m.links.map((l) => `  ${l}`), "");
      lines.push("-----", "");
    }
    const text = lines.join("\n");
    mkdirSync(dirname(resolve(file)), { recursive: true });
    writeFileSync(file, text);
    const head = Number(flags.head ?? 12);
    console.log(
      `${file}: ${thread.messages.length} message(s), ${text.split("\n").length} lines, ${text.length} chars`,
    );
    console.log(text.split("\n").slice(0, head).join("\n"));
    break;
  }
  case "draft": {
    if (typeof flags.to !== "string")
      fail("draft needs --to <address>[,<address>]");
    const saved = inBrowser(recipe, "draft", {
      to: flags.to,
      cc: typeof flags.cc === "string" ? flags.cc : "",
      subject: typeof flags.subject === "string" ? flags.subject : "",
      body: bodyOf(flags),
    });
    console.log(saved);
    break;
  }
  case "reply": {
    const [id] = positional;
    if (!id)
      fail("Usage: mail.mjs <site> reply <id> --body-file <file> [--all]");
    const saved = inBrowser(recipe, "reply", {
      id,
      all: flags.all === true,
      body: bodyOf(flags),
    });
    console.log(saved);
    break;
  }
  default:
    fail(`Unknown command ${command}: list, unread, read, draft or reply.`);
}
