import { tool } from "ai";
import z from "zod";
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
}: {
  skills: SkillMetadata[];
  sandbox: Sandbox;
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
      execute: async ({ name }, { messages }) => {
        const named = (list: SkillMetadata[]) =>
          list.find((s) => s.name.toLowerCase() === name.toLowerCase());
        // The list is read when the run starts; a skill installed since is only on disk
        const listed = named(skills) ? skills : await loadSkills(sandbox);
        const skill = named(listed);
        if (!skill) {
          return {
            error: `No skill named '${name}'.`,
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

        const files = await sandbox.glob("**/*", {
          path: skill.path,
          limit: 50,
        });

        return {
          skillDirectory: skill.path,
          files,
          content: body,
        };
      },
    }),
  };
};
