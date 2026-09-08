import {
  mkdir,
  readdir,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import { parse, stringify } from "yaml";
import { APP_DIR, DATA_DIR, PATHS } from "@/config";
import type {
  SkillEntry,
  SkillFrontmatter,
  SkillNode,
  SkillSource,
  SkillSummary,
} from "@/features/skills/skills.schema";
import { SkillFrontmatterSchema } from "@/features/skills/skills.schema";
import { publicError } from "@/lib/public-error";

/** Skills are folders on disk, so "query" here means the filesystem. Nothing else touches the skill dirs. */

const ROOTS: Record<SkillSource, string> = {
  default: resolve(APP_DIR, PATHS.skills.default),
  custom: resolve(DATA_DIR, PATHS.skills.custom),
};

const HIDDEN = new Set([".DS_Store", "__MACOSX"]);

/** Above this a file is an asset, not shown inline. */
const MAX_INLINE_BYTES = 512 * 1024;

/** Resolves a skill folder under its root; `..`, absolute paths and anything outside are refused alike. */
function skillDir(source: SkillSource, dir: string) {
  const root = ROOTS[source];
  const full = resolve(root, dir);
  const rel = relative(root, full);
  if (!rel || rel.startsWith("..") || rel.includes(sep) || rel === ".") {
    publicError("Skill not found");
  }
  return full;
}

function insideSkill(base: string, path: string) {
  const full = resolve(base, path);
  const rel = relative(base, full);
  if (rel.startsWith("..") || resolve(full) !== full) {
    publicError("File not found");
  }
  return full;
}

/**
 * Splits SKILL.md into YAML head and body. The one regex both readers share.
 * `rest` is the untrimmed remainder, for writing the file back unchanged.
 */
export function splitFrontmatter(content: string): {
  head: string | null;
  body: string;
  rest: string;
  /** The delimiter lines; their line breaks are the file's. */
  fence: string;
} {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!match)
    return { head: null, body: content.trim(), rest: content, fence: "" };
  const rest = content.slice(match[0].length);
  return { head: match[1] ?? null, body: rest.trim(), rest, fence: match[0] };
}

export function parseFrontmatter(content: string): SkillFrontmatter {
  const { head } = splitFrontmatter(content);
  if (!head) {
    publicError("SKILL.md needs a YAML block with name and description");
  }
  let raw: unknown;
  try {
    raw = parse(head);
  } catch {
    publicError("SKILL.md frontmatter is not valid YAML");
  }
  const parsed = SkillFrontmatterSchema.safeParse(raw);
  if (!parsed.success) {
    publicError(
      `SKILL.md frontmatter: ${parsed.error.issues[0]?.message ?? "invalid"}`,
    );
  }
  return parsed.data;
}

/** The top-level `disabled` line in the head; nested keys and block scalars are indented and do not match. */
const DISABLED_LINE = /^disabled[ \t]*:[^\n]*(\r?\n|$)/m;

/**
 * Adds or removes the `disabled` line in SKILL.md front matter. Only that one
 * line is touched: re-serialising the head would refold long descriptions.
 * Default skills are git-tracked, so disabling one shows in `git status`.
 */
export async function setSkillDisabled(
  source: SkillSource,
  dir: string,
  disabled: boolean,
): Promise<void> {
  const file = join(skillDir(source, dir), "SKILL.md");
  let content: string;
  try {
    content = await readFile(file, "utf-8");
  } catch {
    publicError("Skill not found");
  }
  const { head, rest, fence } = splitFrontmatter(content);
  if (!head) publicError("This SKILL.md has no frontmatter to write to");

  let parsed: unknown;
  try {
    parsed = parse(head);
  } catch {
    publicError("SKILL.md frontmatter is not valid YAML");
  }
  // Valid YAML is not necessarily a mapping: a bare scalar or an empty block has nowhere to put a key
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    publicError("SKILL.md frontmatter is not a YAML mapping");
  }

  const eol = fence.includes("\r\n") ? "\r\n" : "\n";
  const next = disabled
    ? DISABLED_LINE.test(head)
      ? head.replace(DISABLED_LINE, `disabled: true$1`)
      : `${head.replace(/\s+$/, "")}${eol}disabled: true`
    : head.replace(DISABLED_LINE, "").replace(/\s+$/, "");

  await writeFile(file, `---${eol}${next}${eol}---${eol}${rest}`);
}

/** Inverse of parseFrontmatter; unknown keys (license etc.) are kept. */
export function renderSkillMarkdown(
  meta: SkillFrontmatter | Record<string, unknown>,
  body: string,
) {
  return `---\n${stringify(meta).trim()}\n---\n\n${body.trim()}\n`;
}

async function readSummary(
  source: SkillSource,
  dir: string,
): Promise<SkillSummary | null> {
  try {
    const content = await readFile(
      join(ROOTS[source], dir, "SKILL.md"),
      "utf-8",
    );
    return { ...parseFrontmatter(content), source, dir };
  } catch {
    // A folder without a readable SKILL.md is not a skill, same as discoverSkills
    return null;
  }
}

/** default first, then custom: the agent's priority (skills.discover). */
export async function findAllSkills(): Promise<SkillSummary[]> {
  const out: SkillSummary[] = [];
  for (const source of ["default", "custom"] as const) {
    let names: string[] = [];
    try {
      names = (await readdir(ROOTS[source], { withFileTypes: true }))
        .filter((e) => e.isDirectory() && !HIDDEN.has(e.name))
        .map((e) => e.name)
        .sort();
    } catch {
      continue; // a fresh install has no custom skills folder yet
    }
    for (const dir of names) {
      const summary = await readSummary(source, dir);
      if (summary) out.push(summary);
    }
  }
  return out;
}

/** The folder listing or file text at `path` inside a skill. */
export async function readSkillNode(
  source: SkillSource,
  dir: string,
  path = "",
): Promise<SkillNode> {
  const base = skillDir(source, dir);
  const full = insideSkill(base, path);

  let info: Awaited<ReturnType<typeof stat>>;
  try {
    info = await stat(full);
  } catch {
    publicError("File not found");
  }

  if (info.isDirectory()) {
    const entries = await readdir(full, { withFileTypes: true });
    const rows: SkillEntry[] = [];
    for (const entry of entries) {
      if (HIDDEN.has(entry.name)) continue;
      if (entry.isDirectory()) {
        rows.push({ name: entry.name, kind: "dir" });
      } else if (entry.isFile()) {
        const s = await stat(join(full, entry.name));
        rows.push({ name: entry.name, kind: "file", size: s.size });
      }
    }
    // Folders first, then files, each alphabetical
    rows.sort(
      (a, b) =>
        Number(a.kind === "file") - Number(b.kind === "file") ||
        a.name.localeCompare(b.name),
    );
    return { kind: "dir", entries: rows };
  }

  if (info.size > MAX_INLINE_BYTES) {
    return { kind: "file", content: null, size: info.size };
  }
  const bytes = await readFile(full);
  // A NUL byte in the first 1KB marks binary
  const binary = bytes.subarray(0, 1024).includes(0);
  return {
    kind: "file",
    content: binary ? null : bytes.toString("utf-8"),
    size: info.size,
  };
}

/** Writes a custom skill from a set of files. Never overwrites; delete first. */
export async function writeCustomSkill(
  dir: string,
  files: Map<string, Uint8Array | string>,
): Promise<SkillSummary> {
  const base = skillDir("custom", dir);
  const taken = async (path: string) =>
    stat(path).then(
      () => true,
      () => false,
    );
  if (await taken(base)) publicError(`A skill named "${dir}" already exists`);
  // A same-named default skill would shadow it (skills.discover), so refuse up front
  if (await taken(skillDir("default", dir))) {
    publicError(`"${dir}" is a built-in skill — pick another name`);
  }

  await mkdir(base, { recursive: true });
  try {
    for (const [path, data] of files) {
      const full = insideSkill(base, path);
      await mkdir(resolve(full, ".."), { recursive: true });
      await writeFile(full, data);
    }
  } catch (error) {
    // A half-written skill would be listed and then fail to load
    await rm(base, { recursive: true, force: true });
    throw error;
  }

  const summary = await readSummary("custom", dir);
  if (!summary) {
    await rm(base, { recursive: true, force: true });
    publicError("SKILL.md could not be read back");
  }
  return summary;
}

/** Only custom skills can be deleted. */
export async function deleteCustomSkill(dir: string) {
  const base = skillDir("custom", dir);
  const exists = await stat(base).then(
    () => true,
    () => false,
  );
  if (!exists) publicError("Skill not found");
  await rm(base, { recursive: true, force: true });
}
