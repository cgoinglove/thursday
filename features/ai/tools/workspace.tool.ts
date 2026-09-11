import { relative } from "node:path";
import { type ToolSet, tool } from "ai";
import z from "zod";
import { EXEC_TIMEOUT_MS } from "@/config";
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
    /** Attach the shell guide to this run's first `bash` result (bots only). */
    guide?: boolean;
    /** How long one command may run; unset is the sandbox's own limit (config EXEC_TIMEOUT_MS). */
    timeoutMs?: number;
  },
): ToolSet => {
  /** Fold absolute sandbox paths against cwd; they still resolve when handed back. */
  const short = (p: string) => {
    const r = relative(sandbox.cwd, p);
    return r && !r.startsWith("..") ? r : p;
  };

  // The tool set is built per run, so one guide per run lives in this closure.
  let owed = options.guide === true;

  const bash = tool({
    description: "Run a bash command.",
    inputSchema: z.object({
      command: z.string(),
      description: z
        .string()
        .nullish()
        .describe(
          "One short line for the user: what this command does and why. Shown on their screen while it runs — not a restatement of the command.",
        ),
    }),
    // The only tool here long-running enough to be cancelled.
    execute: async ({ command }, { abortSignal }) => {
      const result = await sandbox.exec(command, {
        signal: abortSignal,
        env: options.env,
        timeoutMs: options.timeoutMs,
      });
      if (!owed) return result;
      owed = false;
      return { ...result, guide: SHELL_GUIDE };
    },
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
        .nullish()
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

/**
 * How this shell differs from a terminal, attached to a run's first `bash`
 * result and never again. Each line is a way a job is lost for minutes and
 * none can be found out from a command's output: state that silently does not
 * carry, a question nobody will answer, a variable that was removed rather
 * than never set. What this machine *has* is not here — that decides the first
 * command, so it is in the prompt (prompts/bot.prompt environment).
 */
const SHELL_GUIDE = `## The shell here

Every command is a new shell: \`cd\`, exported variables and an activated venv are gone by the next one — chain what depends on the last step into a single command.

Nothing is watching it. A command that stops to ask never gets an answer and is killed after ${EXEC_TIMEOUT_MS / 1000}s, so pass the flag that skips the question (\`-y\`, \`--yes\`, \`--no-input\`), and send anything genuinely long to the background with its output redirected to a file.

Keys are not in the environment: every variable named like a key, a token or a secret is removed before the shell starts. An empty one is not an unset one — say which it was, and ask for what a command needs.`;
