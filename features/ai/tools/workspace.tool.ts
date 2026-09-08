import { relative } from "node:path";
import { type ToolSet, tool } from "ai";
import z from "zod";
import { TOOL_NAMES } from "@/features/ai/tools/tool-name";
import { writeRefusal } from "@/features/workspace/workspace";
import type { Sandbox } from "@/lib/sandbox";

/**
 * Shell access, plus `write_file` for bots: multi-line files through a
 * heredoc are the most common way a shell command goes wrong.
 */
export const createWorkspaceTools = (
  sandbox: Sandbox,
  options: {
    write: boolean;
    /** Per-run environment for `bash` (a job's browser session). */
    env?: Record<string, string>;
  },
): ToolSet => {
  /** Fold absolute sandbox paths against cwd; they still resolve when handed back. */
  const short = (p: string) => {
    const r = relative(sandbox.cwd, p);
    return r && !r.startsWith("..") ? r : p;
  };

  const bash = tool({
    description: "Run a bash command.",
    inputSchema: z.object({
      command: z.string(),
      description: z
        .string()
        .nullable()
        .describe(
          "One short line for the user: what this command does and why. Shown on their screen while it runs — not a restatement of the command.",
        ),
    }),
    // The only tool here long-running enough to be cancelled.
    execute: ({ command }, { abortSignal }) =>
      sandbox.exec(command, { signal: abortSignal, env: options.env }),
  });

  if (!options.write) return { [TOOL_NAMES.bash]: bash };

  const writeFile = tool({
    description:
      "Write a whole file — what was there is gone. Parent directories are created.",
    inputSchema: z.object({
      path: z
        .string()
        .describe(
          "Relative to the working directory — under one of its folders — or absolute",
        ),
      content: z.string(),
      description: z
        .string()
        .nullable()
        .describe(
          "One short line for the user: what this file is. Shown on their screen next to the path.",
        ),
    }),
    execute: async ({ path, content }) => {
      const full = sandbox.resolve(path);
      const refusal = writeRefusal(full);
      if (refusal) return refusal;
      await sandbox.writeFile(path, content);
      return `Wrote ${short(full)} (${content.split("\n").length} lines)`;
    },
  });

  return { [TOOL_NAMES.bash]: bash, [TOOL_NAMES.write_file]: writeFile };
};
