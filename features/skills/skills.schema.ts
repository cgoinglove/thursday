import { z } from "zod";

/** `default` ships with the app and is read-only; `custom` lives in the workspace's `.agents/skills`. */
export const SKILL_SOURCES = ["custom", "default"] as const;
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

/** The YAML block at the top of every SKILL.md. `disabled` lives in the file so state travels with the folder. */
export const SkillFrontmatterSchema = z.object({
  name: SkillNameSchema,
  description: z.string().trim().min(1, "Description is required"),
  /** true hides the skill from the list and the prompt; absent means enabled. */
  disabled: z.boolean().optional(),
});
export type SkillFrontmatter = z.infer<typeof SkillFrontmatterSchema>;

/** A hand-typed single-file skill. */
export const SkillDraftSchema = SkillFrontmatterSchema.extend({
  content: z.string().trim().min(1, "Content is required"),
});
export type SkillDraft = z.infer<typeof SkillDraftSchema>;

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

/** A path inside a skill: a folder listing or a file's text. Binary files come back with `content: null`. */
export type SkillNode =
  | { kind: "dir"; entries: SkillEntry[] }
  | { kind: "file"; content: string | null; size: number };

/** Server action args travel as JSON, so file bytes go as base64. */
export const SkillUploadSchema = z.object({
  fileName: z.string().trim().min(1),
  base64: z.string().min(1),
});
export type SkillUpload = z.infer<typeof SkillUploadSchema>;
