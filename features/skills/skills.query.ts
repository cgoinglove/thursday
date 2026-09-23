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
import { readConfig, writeConfig } from "@/features/config/config.query";
import type {
  SkillEntry,
  SkillFrontmatter,
  SkillNode,
  SkillSource,
  SkillSummary,
} from "@/features/skills/skills.schema";
import {
  parseSkillsOff,
  SKILLS_OFF_KEY,
  SkillFrontmatterSchema,
} from "@/features/skills/skills.schema";
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

/**
 * The folder for a skill that came from elsewhere, from the name it gives itself:
 * a path segment, since the folder goes into a prompt and into a shell command.
 * SKILL.md keeps its own name — only the folder is reduced.
 */
export function skillFolderName(name: string) {
  const dir = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .slice(0, 64)
    .replace(/^-+|-+$/g, "");
  if (!dir)
    publicError("That skill's name has no letters to name a folder with");
  return dir;
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

/** The OSes a skill names, from `metadata.platforms` or the older top-level list. */
function platformsOf({ metadata, platforms }: SkillFrontmatter) {
  const named = metadata?.platforms;
  if (typeof named === "string") return named.split(/[\s,]+/).filter(Boolean);
  return platforms;
}

/** Whether a skill runs on this machine's OS; the list and the prompt both leave out one that does not. */
export const runsHere = (frontmatter: SkillFrontmatter) => {
  const platforms = platformsOf(frontmatter);
  return !platforms?.length || platforms.includes(process.platform);
};

/** The names of the skills the user switched off (skills.schema SKILLS_OFF_KEY). */
export async function readSkillsOff(): Promise<Set<string>> {
  return parseSkillsOff(await readConfig(SKILLS_OFF_KEY));
}

/** Off in Settings, or by the line versions before `SKILLS_OFF_KEY` wrote into the file. */
export const isSkillOff = (frontmatter: SkillFrontmatter, off: Set<string>) =>
  frontmatter.disabled === true || off.has(frontmatter.name.toLowerCase());

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

/** The top-level `disabled` line older versions wrote; nested keys and block scalars are indented and do not match. */
const DISABLED_LINE = /^disabled[ \t]*:[^\n]*(\r?\n|$)/m;

/**
 * Switches a skill off or on by its name, in the user's config. Nothing is written into the
 * skill: a shipped one lives in the app folder, which the app never writes (AGENTS.md › The
 * two roots). Switching on also drops the `disabled` line an older version left in one of the
 * user's own skills, which would keep it off; a shipped skill never carries one from us.
 */
export async function setSkillOff(
  source: SkillSource,
  dir: string,
  off: boolean,
): Promise<void> {
  const file = join(skillDir(source, dir), "SKILL.md");
  let content: string;
  try {
    content = await readFile(file, "utf-8");
  } catch {
    publicError("Skill not found");
  }
  const { name } = parseFrontmatter(content);

  const names = await readSkillsOff();
  if (off) names.add(name.toLowerCase());
  else names.delete(name.toLowerCase());
  await writeConfig(SKILLS_OFF_KEY, JSON.stringify([...names].sort()));

  if (off || source !== "custom") return;
  const { head, rest, fence } = splitFrontmatter(content);
  if (!head || !DISABLED_LINE.test(head)) return;
  const eol = fence.includes("\r\n") ? "\r\n" : "\n";
  const next = head.replace(DISABLED_LINE, "").replace(/\s+$/, "");
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

/** default first, then custom: the agent's priority (skills.discover). `disabled` is whether it is off. */
export async function findAllSkills(): Promise<SkillSummary[]> {
  const out: SkillSummary[] = [];
  const off = await readSkillsOff();
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
      if (summary && runsHere(summary))
        out.push({ ...summary, disabled: isSkillOff(summary, off) });
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

/**
 * Writes one text file back inside a custom skill. The folder is never renamed:
 * `dir` is the skill and `path` the file in it, both checked the same way a read
 * is. Only a file that is already there can be written — the screen edits what it
 * opened, and a new file in a skill is a job for the bot that works in it.
 */
export async function writeSkillFile(
  dir: string,
  path: string,
  content: string,
) {
  const base = skillDir("custom", dir);
  const full = insideSkill(base, path);
  const info = await stat(full).catch(() => null);
  if (!info?.isFile()) publicError("File not found");
  if (Buffer.byteLength(content) > MAX_INLINE_BYTES) {
    publicError("That is larger than this screen can write back");
  }
  // SKILL.md is what the list and every prompt read: a head that no longer
  // parses would drop the skill out of both, so it is refused before it lands.
  if (path === "SKILL.md") parseFrontmatter(content);
  await writeFile(full, content, "utf-8");
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
