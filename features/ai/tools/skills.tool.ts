import { tool } from "ai";
import z from "zod";
import { PATHS, SKILL_FILES_LISTED, SKILLS_FOLDED } from "@/config";
import { TOOL_NAMES } from "@/features/ai/tools/tool-name";
import {
  loadSkills,
  type SkillMetadata,
} from "@/features/skills/skills.discover";
import { splitFrontmatter } from "@/features/skills/skills.query";
import type { Sandbox } from "@/lib/sandbox";

/**
 * Reuse instructions only while their full text remains in this bot's context.
 * A resume can carry them; compaction can remove them.
 */
export const createSkillTools = ({
  skills,
  sandbox,
  bot,
}: {
  skills: SkillMetadata[];
  sandbox: Sandbox;
  /** Whose own skills count too (skills.discover ownSkills); absent for the call. */
  bot?: string;
}) => {
  return {
    [TOOL_NAMES.load_skill]: tool({
      description:
        "Load one skill: its instructions, and the files that ship with it.",
      inputSchema: z.object({
        name: z
          .string()
          .describe(
            "Exact name from the Skills list, or of a skill installed during this job. Do not guess names.",
          ),
      }),
      execute: async ({ name: asked }, { messages }) => {
        const named = (list: SkillMetadata[], one: string) =>
          list.find((s) => s.name.toLowerCase() === one.toLowerCase());
        // The list is read when the run starts; a skill installed since is only on disk
        const listed = named(skills, asked)
          ? skills
          : await loadSkills(sandbox, bot);
        // A shipped skill folded into another, named by a role written before the fold
        const folded = named(listed, asked)
          ? undefined
          : SKILLS_FOLDED[asked.toLowerCase()];
        const skill = named(listed, folded ?? asked);
        if (!skill) {
          return {
            error: `No skill named '${asked}'.`,
            available: listed.map((s) => s.name),
          };
        }

        const skillFile = `${skill.path}/SKILL.md`;
        const carried = messages.some(
          (message) =>
            Array.isArray(message.content) &&
            message.content.some((part) => {
              if (
                part.type !== "tool-result" ||
                part.toolName !== TOOL_NAMES.load_skill ||
                part.output.type !== "json"
              )
                return false;
              const value = part.output.value as {
                skillDirectory?: string;
                content?: string;
              } | null;
              return (
                value?.skillDirectory === skill.path &&
                typeof value.content === "string"
              );
            }),
        );
        if (carried) {
          return {
            skillDirectory: skill.path,
            note: `Use the full '${skill.name}' instructions already in your conversation. To check for changes on disk, read ${skillFile} with the shell.`,
          };
        }

        const content = await sandbox.readFile(skillFile, "utf-8");
        const { body } = splitFrontmatter(content);

        const { files, total } = await sandbox.listFiles(skill.path, {
          limit: SKILL_FILES_LISTED,
          skip: [PATHS.skills.runtime],
        });

        return {
          skillDirectory: skill.path,
          // Each file as the path that opens it. Listed as bare names beside the
          // directory, they were typed as paths from the workspace instead and the
          // first read of a skill's own file failed.
          files: files.map((file) => `${skill.path}/${file}`),
          ...(total > files.length && {
            more: `${total - files.length} more files, deeper in these folders. List a folder in the shell to see them.`,
          }),
          ...(folded && {
            note: `'${asked}' is part of '${skill.name}' now: these are its instructions.`,
          }),
          content: body,
        };
      },
    }),
  };
};
