import { relative } from "node:path";
import { type ToolSet, tool } from "ai";
import z from "zod";
import { PATHS } from "@/config";
import { TOOL_NAMES } from "@/features/ai/tools/tool-name";
import {
  type MachineTools,
  readMachineTools,
  writeRefusal,
} from "@/features/workspace/workspace";
import { EXEC_TIMEOUT_MS, type Sandbox } from "@/lib/sandbox";

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
        .nullable()
        .describe(
          "One short line for the user: what this command does and why. Shown on their screen while it runs — not a restatement of the command.",
        ),
    }),
    // The only tool here long-running enough to be cancelled.
    execute: async ({ command }, { abortSignal }) => {
      const result = await sandbox.exec(command, {
        signal: abortSignal,
        env: options.env,
      });
      if (!owed) return result;
      owed = false;
      return { ...result, guide: await shellGuide(sandbox) };
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

/**
 * What this shell is like, and what this machine has, attached to a run's first
 * `bash` result and never again. Not a prompt chapter for two reasons: half of
 * it is read off the machine at the moment it is asked, where the prompt could
 * only guess, and a rule about a shell is worth nothing to a run that never
 * opens one. Only `bash` carries it — every line here is about the shell, and
 * what `write_file` refuses it says on refusing (workspace.ts writeRefusal).
 */
async function shellGuide(sandbox: Sandbox): Promise<string> {
  const tools = await readMachineTools(sandbox);
  return [SHELL, machine(tools), INSTALLING].join("\n\n");
}

/**
 * How the shell differs from a terminal. Every line is a way a job is lost for
 * minutes: state that does not carry, a question nobody answers, a background
 * command that waits anyway, a key that is not there.
 */
const SHELL = `## The shell here

Every command is a new shell: \`cd\`, exported variables and an activated venv are gone by the next one — chain what depends on the last step into a single command.

Nothing is watching it. A command that stops to ask never gets an answer and is killed after ${EXEC_TIMEOUT_MS / 1000}s, so pass the flag that skips the question (\`-y\`, \`--yes\`, \`--no-input\`). Work that honestly runs longer goes to the background **with its output redirected** — \`pnpm build > ${PATHS.scratch}/build.log 2>&1 &\` — and you read the file; without the redirect the call waits for it anyway.

Keys are not in the environment: every variable named like a key, a token or a secret is removed before the shell starts. Ask for the one a command needs.`;

/** Naming what is absent matters as much as what is present: it is the half the model otherwise assumes. */
function machine(tools: MachineTools): string {
  const line = (label: string, of: MachineTools["runtimes"]) =>
    [
      `${label}: ${of.found.length ? of.found.join(", ") : "none"}.`,
      of.missing.length ? ` Not here: ${of.missing.join(", ")}.` : "",
    ].join("");

  const fenced = tools.managers.found.includes("pnpm")
    ? ` This workspace is fenced for pnpm (\`pnpm-workspace.yaml\`, \`.npmrc\`), so build with it.`
    : "";

  const browser =
    tools.browser === null
      ? ""
      : tools.browser
        ? "Browser: installed."
        : "Browser: not installed — `playwright-cli install-browser chromium` puts one there.";

  return [
    line("Runtimes", tools.runtimes),
    `${line("Package managers", tools.managers)}${fenced}`,
    browser,
  ]
    .filter(Boolean)
    .join("\n");
}

/** The procedure; the capability itself stays in the prompt (prompts/bot.prompt MACHINE). */
const INSTALLING = `What is missing you install — inside the workspace freely, onto the machine once they say yes.`;
