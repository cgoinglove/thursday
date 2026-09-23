// Keeps the agent maps honest: AGENTS.md and .claude/rules/*.md.
//   node scripts/maps.mts            fail on a map over its size, a path glob that matches nothing,
//                                    or a named file that does not exist (run by `pnpm lint`)
//   node scripts/maps.mts --stale    list each map with the commits made to its area since it was
//                                    last checked against the code, most first
// Plain node on purpose: it runs before anything is installed beyond the lockfile.
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { basename, join, matchesGlob } from "node:path";

const ROOT = execFileSync("git", ["rev-parse", "--show-toplevel"], {
  encoding: "utf8",
}).trim();
const RULES = ".claude/rules";
// A map is read whenever its area is; past this it costs more than it tells
const MAX_LINES: Record<string, number> = { "AGENTS.md": 140, "taste.md": 32 };
const MAP_MAX = 64;

const tracked = execFileSync("git", ["ls-files"], {
  cwd: ROOT,
  encoding: "utf8",
})
  .split("\n")
  .filter(Boolean);
const names = new Set(tracked.map((file) => basename(file)));
const tops = new Set(tracked.map((file) => file.split("/")[0]));
const maps = readdirSync(join(ROOT, RULES))
  .filter((file) => file.endsWith(".md"))
  .map((file) => `${RULES}/${file}`);

const globsOf = (text: string) => {
  const head = /^---\n([\s\S]*?)\n---/.exec(text)?.[1] ?? "";
  return [...head.matchAll(/^\s*-\s*"([^"]+)"/gm)].map((match) => match[1]);
};
const areaOf = (globs: string[]) =>
  tracked.filter((file) => globs.some((glob) => matchesGlob(file, glob)));
// Frontmatter is stripped before a rule reaches the model, so the date costs nothing
const checkedOn = (text: string) =>
  /^---\n[\s\S]*?^checked:\s*(\d{4}-\d{2}-\d{2})\s*$[\s\S]*?\n---/m.exec(
    text,
  )?.[1];

// A backticked token that names something in this repository: a path under one of its own
// top-level entries (a file, a folder, or a module named without its extension), or a bare file
// name. Paths elsewhere (dist/, DATA_DIR/…, a URL) are not the repository's to check.
function namedFiles(text: string) {
  const out: string[] = [];
  for (const [, token] of text.matchAll(/`([^`\s]+)`/g)) {
    if (/[*{}<>~@]/.test(token) || token.startsWith("/")) continue;
    if (
      token.includes("/")
        ? tops.has(token.split("/")[0])
        : /\.(ts|tsx|mts|mjs|cjs|js|md|json|css|yml|yaml)$/.test(token)
    )
      out.push(token);
  }
  return out;
}
const exists = (token: string) => {
  const path = token.replace(/\/$/, "");
  if (!token.includes("/")) return names.has(path);
  return tracked.some(
    (file) =>
      file === path ||
      file.startsWith(`${path}/`) ||
      file.startsWith(`${path}.`),
  );
};

if (process.argv.includes("--stale")) {
  const rows = maps
    .filter((map) => basename(map) !== "taste.md")
    .map((map) => {
      const text = readFileSync(join(ROOT, map), "utf8");
      const since = checkedOn(text);
      const area = areaOf(globsOf(text));
      const commits =
        since && area.length
          ? execFileSync(
              "git",
              ["log", `--since=${since}`, "--format=%h", "--", ...area],
              { cwd: ROOT, encoding: "utf8" },
            )
              .split("\n")
              .filter(Boolean).length
          : Number.POSITIVE_INFINITY;
      return { map, since: since ?? "never", commits };
    });
  rows.sort((a, b) => b.commits - a.commits);
  for (const row of rows)
    console.log(`${String(row.commits).padStart(4)}  ${row.since}  ${row.map}`);
  process.exit(0);
}

const problems: string[] = [];
for (const file of ["AGENTS.md", ...maps]) {
  const text = readFileSync(join(ROOT, file), "utf8");
  const lines = text.split("\n").length - 1;
  const max = MAX_LINES[basename(file)] ?? MAX_LINES[file] ?? MAP_MAX;
  if (lines > max) problems.push(`${file}: ${lines} lines, over ${max}`);
  if (file !== "AGENTS.md") {
    const globs = globsOf(text);
    // A rule file with no paths is loaded into every session
    if (!globs.length) problems.push(`${file}: no paths: frontmatter`);
    for (const glob of globs)
      if (!areaOf([glob]).length)
        problems.push(`${file}: "${glob}" matches no tracked file`);
    if (!checkedOn(text) && basename(file) !== "taste.md")
      problems.push(`${file}: no "checked: <date>" in its frontmatter`);
  }
  for (const token of namedFiles(text))
    if (!exists(token)) problems.push(`${file}: \`${token}\` does not exist`);
}
if (problems.length) {
  console.error(
    `Agent maps out of date:\n${problems.map((line) => `  ${line}`).join("\n")}`,
  );
  process.exit(1);
}
