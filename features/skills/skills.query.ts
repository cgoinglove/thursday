import { createHash } from "node:crypto";
import {
  mkdir,
  readdir,
  readFile,
  realpath,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { parse, stringify } from "yaml";
import { APP_DIR, DATA_DIR, PATHS, SKILL_FILES } from "@/config";
import { listBotNames } from "@/features/bot/bot.query";
import { readConfig, writeConfig } from "@/features/config/config.query";
import type {
  SkillEntry,
  SkillFrontmatter,
  SkillNode,
  SkillSource,
  SkillSummary,
} from "@/features/skills/skills.schema";
import {
  botOfSource,
  isEditableSource,
  parseSkillsOff,
  SKILLS_OFF_KEY,
  SkillFrontmatterSchema,
} from "@/features/skills/skills.schema";
import { botFolderName, WORKSPACE } from "@/features/workspace/workspace";
import { logger } from "@/lib/logger";
import { publicError } from "@/lib/public-error";
import { errorToString } from "@/lib/utils";

/** Skills are folders on disk, so "query" here means the filesystem. Nothing else touches the skill dirs. */

/** Where each source's skill folders sit (skills.schema SkillSourceSchema). */
function rootOf(source: SkillSource): string {
  if (source === "default") return resolve(APP_DIR, PATHS.skills.default);
  if (source === "custom") return resolve(DATA_DIR, PATHS.skills.custom);
  const bot = botOfSource(source) ?? "";
  // A kit is read where it ships, by the bot's name lowercased (skills.discover seedSkills)
  return source.startsWith("kit:")
    ? resolve(APP_DIR, PATHS.skills.seeds, bot.toLowerCase())
    : resolve(WORKSPACE, PATHS.bots, bot, PATHS.skills.own);
}

/**
 * Copies the app once made in a ready-made bot's folder and no longer ships there
 * (`seed-skills/retired.json`): one still byte for byte as shipped is neither listed to the
 * bot nor on the Skills screen, so an old copy is not seen beside what replaced it. One the
 * user changed is theirs and stays.
 */
let retired: Promise<Map<string, Set<string>>> | undefined;
export const readRetired = () =>
  (retired ??= readFile(
    join(APP_DIR, PATHS.skills.seeds, "retired.json"),
    "utf8",
  )
    .then((text) => {
      const { sha256 } = JSON.parse(text) as {
        sha256: Record<string, string[]>;
      };
      return new Map(
        Object.entries(sha256).map(([name, hashes]) => [name, new Set(hashes)]),
      );
    })
    .catch(() => new Map<string, Set<string>>()));

const isRetiredCopy = (
  retiredCopies: Map<string, Set<string>>,
  name: string,
  content: string,
) =>
  retiredCopies
    .get(name)
    ?.has(createHash("sha256").update(content, "utf8").digest("hex")) ?? false;

const HIDDEN = new Set([".DS_Store", "__MACOSX"]);

/** Resolves a skill folder under its root; `..`, absolute paths and anything outside are refused alike. */
function skillDir(source: SkillSource, dir: string) {
  const root = rootOf(source);
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
  // Another drive on Windows comes back absolute
  if (rel.startsWith("..") || isAbsolute(rel)) publicError("File not found");
  return full;
}

/**
 * Where `full` really is, refused when a link inside the skill leads out of it: this screen
 * reads and writes a skill's own files, and a link in a downloaded one is not a way to the
 * rest of the disk. The skill's own folder may itself be a link (an installer's shared copy).
 */
async function stillInside(base: string, full: string): Promise<string> {
  const [root, target] = await Promise.all([
    realpath(base),
    realpath(full),
  ]).catch(() => publicError("File not found"));
  const rel = relative(root, target);
  if (rel.startsWith("..") || isAbsolute(rel)) publicError("File not found");
  return target;
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

/**
 * The names of the skills the user switched off (skills.schema SKILLS_OFF_KEY). Every prompt
 * lists skills through this, so a config that cannot be read lists them all rather than
 * failing the prompt.
 */
export async function readSkillsOff(): Promise<Set<string>> {
  try {
    return parseSkillsOff(await readConfig(SKILLS_OFF_KEY));
  } catch (cause) {
    logger.warn(
      `skills switched off could not be read — ${errorToString(cause)}`,
    );
    return new Set();
  }
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

  // Read as it is, not through readSkillsOff: a list that failed to load must not be written over
  const names = parseSkillsOff(await readConfig(SKILLS_OFF_KEY));
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
  retiredCopies: Map<string, Set<string>>,
): Promise<SkillSummary | null> {
  try {
    const content = await readFile(
      join(rootOf(source), dir, "SKILL.md"),
      "utf-8",
    );
    const frontmatter = parseFrontmatter(content);
    if (
      source.startsWith("own:") &&
      isRetiredCopy(retiredCopies, frontmatter.name, content)
    )
      return null;
    return { ...frontmatter, source, dir };
  } catch {
    // A folder without a readable SKILL.md is not a skill, same as discoverSkills
    return null;
  }
}

/**
 * Every skill a bot can read, where it lives: the shipped ones and the user's own (every
 * bot's), then each bot's own — what its ready-made kit ships and what it found or wrote for
 * itself. `disabled` is whether it is off. A bot's own are on this list so that what one
 * installed from the registry for itself is seen, and can be switched off or deleted.
 */
export async function findAllSkills(): Promise<SkillSummary[]> {
  const out: SkillSummary[] = [];
  const off = await readSkillsOff();
  const retiredCopies = await readRetired();
  const bots = await listBotNames().catch((cause) => {
    logger.warn(
      `skills: the bots could not be listed — ${errorToString(cause)}`,
    );
    return [] as string[];
  });
  const sources: { source: SkillSource; bot?: string }[] = [
    { source: "default" },
    { source: "custom" },
    ...[...bots]
      .sort((a, b) => a.localeCompare(b))
      .flatMap((bot) => [
        { source: `kit:${botFolderName(bot)}` as const, bot },
        { source: `own:${botFolderName(bot)}` as const, bot },
      ]),
  ];
  for (const { source, bot } of sources) {
    let names: string[] = [];
    try {
      names = (await readdir(rootOf(source), { withFileTypes: true }))
        .filter((e) => e.isDirectory() && !HIDDEN.has(e.name))
        .map((e) => e.name)
        .sort();
    } catch {
      continue; // a folder nothing has been put in yet
    }
    for (const dir of names) {
      const summary = await readSummary(source, dir, retiredCopies);
      if (summary && runsHere(summary))
        out.push({
          ...summary,
          ...(bot ? { bot } : {}),
          disabled: isSkillOff(summary, off),
        });
    }
  }
  return out;
}

/** A SKILL.md's description as its YAML says it; none when the head does not parse. */
function describedAs(content: string) {
  try {
    return parseFrontmatter(content).description;
  } catch {
    return undefined;
  }
}

/** The folder listing or file text at `path` inside a skill. */
export async function readSkillNode(
  source: SkillSource,
  dir: string,
  path = "",
): Promise<SkillNode> {
  const base = skillDir(source, dir);
  const asked = insideSkill(base, path);
  const full = await stillInside(base, asked);

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

  if (info.size > SKILL_FILES.inlineBytes) {
    return { kind: "file", content: null, size: info.size };
  }
  const bytes = await readFile(full);
  // A NUL byte in the first 1KB marks binary
  const binary = bytes.subarray(0, 1024).includes(0);
  const content = binary ? null : bytes.toString("utf-8");
  return {
    kind: "file",
    content,
    size: info.size,
    ...(content !== null && asked === join(base, "SKILL.md")
      ? { description: describedAs(content) }
      : {}),
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

  const summary = await readSummary("custom", dir, new Map());
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
  source: SkillSource,
  dir: string,
  path: string,
  content: string,
) {
  if (!isEditableSource(source))
    publicError("A skill that ships with the app is read-only");
  const base = skillDir(source, dir);
  const full = await stillInside(base, insideSkill(base, path));
  const info = await stat(full).catch(() => null);
  if (!info?.isFile()) publicError("File not found");
  if (Buffer.byteLength(content) > SKILL_FILES.inlineBytes) {
    publicError("That is larger than this screen can write back");
  }
  // SKILL.md is what the list and every prompt read: a head that no longer
  // parses would drop the skill out of both, so it is refused before it lands.
  if (path === "SKILL.md") parseFrontmatter(content);
  await writeFile(full, content, "utf-8");
}

/** The user's own and what a bot wrote for itself can be deleted; what ships cannot. */
export async function deleteSkill(source: SkillSource, dir: string) {
  if (!isEditableSource(source))
    publicError("A skill that ships with the app can only be switched off");
  const base = skillDir(source, dir);
  const exists = await stat(base).then(
    () => true,
    () => false,
  );
  if (!exists) publicError("Skill not found");
  await rm(base, { recursive: true, force: true });
}
