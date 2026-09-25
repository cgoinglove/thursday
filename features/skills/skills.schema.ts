import { z } from "zod";

/**
 * Where a skill lives, which decides who reads it and what the user may do with it:
 * - `default` ships with the app, every bot's, read-only;
 * - `custom` is the user's own in the workspace's `.agents/skills`, every bot's;
 * - `kit:<bot>` ships with a ready-made bot (`seed-skills/<name>`), that bot's alone, read-only;
 * - `own:<bot>` is one a bot found or wrote for itself (`bots/<bot>/.agents/skills`), that
 *   bot's alone. `<bot>` is its folder name (workspace botFolderName).
 */
export const SkillSourceSchema = z.union([
  z.enum(["custom", "default"]),
  z.templateLiteral(["kit:", z.string().regex(/^[\p{L}\p{N}_-]+$/u)]),
  z.templateLiteral(["own:", z.string().regex(/^[\p{L}\p{N}_-]+$/u)]),
]);
export type SkillSource = z.infer<typeof SkillSourceSchema>;

/** The user's to change and delete: their own, and what a bot wrote for itself. */
export const isEditableSource = (source: SkillSource) =>
  source === "custom" || source.startsWith("own:");

/** The bot a `kit:` or `own:` source belongs to, by its folder name; null for every bot's. */
export const botOfSource = (source: SkillSource): string | null =>
  source.startsWith("kit:") || source.startsWith("own:")
    ? source.slice(4)
    : null;

/** The skill's folder name; also a path segment, so restricted to what every filesystem and URL accepts. */
export const SkillNameSchema = z
  .string()
  .trim()
  .min(1, "Skill name is required")
  .max(64, "Skill name is too long")
  .regex(
    /^[a-z0-9][a-z0-9_-]*$/i,
    "Use letters, numbers, dashes and underscores only",
  );

/**
 * The `name` in SKILL.md. Not a path — the folder is — and a skill written elsewhere
 * titles itself however it likes, so anything readable is taken: a stricter rule here
 * drops that skill out of every prompt and out of the list. `load_skill` matches it as text.
 */
export const SkillTitleSchema = z
  .string()
  .trim()
  .min(1, "Skill name is required")
  .max(64, "Skill name is too long");

/**
 * The YAML block at the top of every SKILL.md, as the Agent Skills spec has it: `name`,
 * `description`, and optionally `license`, `compatibility`, `metadata`, `allowed-tools`.
 * Whether a skill is switched off is the user's (`SKILLS_OFF_KEY`), never the file's: a
 * shipped skill sits in the read-only app folder, and a key outside the spec fails the
 * skill anywhere else it is uploaded.
 */
export const SkillFrontmatterSchema = z.object({
  name: SkillTitleSchema,
  description: z.string().trim().min(1, "Description is required"),
  /**
   * The spec's string-to-string map. `platforms` in it lists the `process.platform` values
   * the skill runs on (`darwin`, or several split by spaces or commas); elsewhere it is not
   * listed at all. Absent means everywhere.
   */
  metadata: z.record(z.string(), z.unknown()).optional(),
  /** Written by versions before `SKILLS_OFF_KEY`; still read as off. */
  disabled: z.boolean().optional(),
  /** The top-level form of `metadata.platforms` a skill made elsewhere may carry; still read. */
  platforms: z.array(z.string()).optional(),
});
export type SkillFrontmatter = z.infer<typeof SkillFrontmatterSchema>;

/** The config key holding the names of the skills the user switched off, as a JSON array. */
export const SKILLS_OFF_KEY = "SKILLS_OFF";

/** The stored list, lowercased; anything unreadable reads as nothing switched off. */
export function parseSkillsOff(value: string | undefined): Set<string> {
  if (!value) return new Set();
  try {
    const list: unknown = JSON.parse(value);
    return new Set(
      Array.isArray(list)
        ? list
            .filter((name): name is string => typeof name === "string")
            .map((name) => name.trim().toLowerCase())
        : [],
    );
  } catch {
    return new Set();
  }
}

/** A hand-typed single-file skill; its name is also the folder it is written to. */
export const SkillDraftSchema = SkillFrontmatterSchema.extend({
  name: SkillNameSchema,
  content: z.string().trim().min(1, "Content is required"),
});

/**
 * A description's first sentence: what the skill does (.claude/rules/skills.md). The rest
 * says when a bot should load it, which is the bot's to read, not the person's.
 */
export const firstSentence = (description: string): string =>
  description
    .trim()
    .split(/(?<=[.。])\s|\n/)[0]
    .trim();

/** A skill list row. */
export type SkillSummary = SkillFrontmatter & {
  source: SkillSource;
  /** Folder name; differs from `name` only for skills not created here. */
  dir: string;
  /** The bot a `kit:` or `own:` skill is for, by name as the roster shows it. */
  bot?: string;
};

/** One entry of a folder listing inside a skill. */
export type SkillEntry = {
  name: string;
  kind: "dir" | "file";
  /** Bytes; absent for folders. */
  size?: number;
};

/**
 * A path inside a skill: a folder listing or a file's text. Binary files come back with
 * `content: null`; the skill's own SKILL.md with its description, read from its head.
 */
export type SkillNode =
  | { kind: "dir"; entries: SkillEntry[] }
  | {
      kind: "file";
      content: string | null;
      size: number;
      description?: string;
    };
