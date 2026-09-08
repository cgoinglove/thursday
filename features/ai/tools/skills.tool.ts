import { tool } from "ai";
import z from "zod";
import { TOOL_NAMES } from "@/features/ai/tools/tool-name";
import type { SkillMetadata } from "@/features/skills/skills.discover";
import { splitFrontmatter } from "@/features/skills/skills.query";
import type { Sandbox } from "@/lib/sandbox";

/**
 * A skill's full text is returned once per run; repeat loads get a pointer
 * back to the first result, since every step resends the whole context.
 * The tool set is built per run, so the `loaded` set lives in this closure.
 */
export const createSkillTools = ({
  skills,
  sandbox,
}: {
  skills: SkillMetadata[];
  sandbox: Sandbox;
}) => {
  const loaded = new Set<string>();
  return {
    [TOOL_NAMES.load_skill]: tool({
      description:
        "Load one skill: its instructions, and the files that ship with it.",
      inputSchema: z.object({
        name: z
          .string()
          .describe(
            "Exact name from the Skills list. Do not guess names that are not on it.",
          ),
      }),
      execute: async ({ name }) => {
        const skill = skills.find(
          (s) => s.name.toLowerCase() === name.toLowerCase(),
        );
        if (!skill) {
          return {
            error: `No skill named '${name}'.`,
            available: skills.map((s) => s.name),
          };
        }

        const skillFile = `${skill.path}/SKILL.md`;
        if (loaded.has(skill.path)) {
          return {
            skillDirectory: skill.path,
            note: `You already loaded '${skill.name}' in this run — its instructions are above, unchanged. Scroll back to that result rather than reading it again; if you need the file itself, read ${skillFile} with the shell.`,
          };
        }

        const content = await sandbox.readFile(skillFile, "utf-8");
        const { body } = splitFrontmatter(content);

        const files = await sandbox.glob("**/*", {
          path: skill.path,
          limit: 50,
        });
        loaded.add(skill.path);

        return {
          skillDirectory: skill.path,
          files,
          content: body,
        };
      },
    }),
  };
};
