import { z } from "zod";

/** `default` ships with the app and is read-only; `custom` lives in the workspace's `.agents/skills`. */
const SKILL_SOURCES = ["custom", "default"] as const;
export const SkillSourceSchema = z.enum(SKILL_SOURCES);
export type SkillSource = z.infer<typeof SkillSourceSchema>;

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

/** A skill list row. */
export type SkillSummary = SkillFrontmatter & {
  source: SkillSource;
  /** Folder name; differs from `name` only for skills not created here. */
  dir: string;
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

/** Server action args travel as JSON, so file bytes go as base64. */
export const SkillUploadSchema = z.object({
  fileName: z.string().trim().min(1),
  base64: z.string().min(1),
});
