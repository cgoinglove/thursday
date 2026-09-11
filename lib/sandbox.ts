import { spawn } from "node:child_process";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve as pathResolve, relative, sep } from "node:path";
import { EXEC_KILL_GRACE_MS, EXEC_TIMEOUT_MS } from "@/config";

export type ExecResult = { stdout: string; stderr: string; exitCode: number };

export interface Sandbox {
  /** Absolute. Relative paths resolve from here */
  readonly cwd: string;
  resolve(path: string): string;

  readFile(path: string, encoding: "utf-8"): Promise<string>;
  writeFile(path: string, content: string | Buffer): Promise<void>;
  readdir(
    path: string,
    opts: { withFileTypes: true },
  ): Promise<{ name: string; isDirectory(): boolean }[]>;

  /** Find by file name/path */
  glob(
    pattern: string,
    opts?: { path?: string; limit?: number },
  ): Promise<string[]>;

  exec(
    command: string,
    opts?: {
      cwd?: string;
      timeoutMs?: number;
      signal?: AbortSignal;
      /** Laid over the shell's environment for this one command. */
      env?: Record<string, string>;
    },
  ): Promise<ExecResult>;

  /**
   * Folds long text to head and tail, writing the whole under the spill dir and
   * naming the path in between. Shell output goes through this on its own;
   * tools that fetch (MCP) call it themselves.
   */
  fold(text: string, name?: string): Promise<string>;
}

const IGNORE = new Set([
  "node_modules",
  ".git",
  ".next",
  "dist",
  "build",
  ".venv",
  "__pycache__",
  ".turbo",
  "coverage",
]);

/**
 * Every file under `dir`, skipping dot entries and the folders a build or a
 * package manager fills (IGNORE). A folder that cannot be read yields nothing.
 */
export async function* walkFiles(dir: string): AsyncGenerator<string> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (IGNORE.has(e.name) || e.name.startsWith(".")) continue;
    const full = join(dir, e.name);
    if (e.isDirectory()) yield* walkFiles(full);
    else if (e.isFile()) yield full;
  }
}

/**
 * Environment for every shell the agent runs: nobody watches it, so no pager
 * may stall it, and secrets do not travel to children. playwright-cli runs
 * from here too and needs only a working PATH.
 */
function shellEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };

  // A compromised npm dependency would read keys straight out of process.env
  for (const name of Object.keys(env)) {
    if (/KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|_AUTH/i.test(name)) {
      delete env[name];
    }
  }

  env.TERM = "dumb";
  env.PAGER = "cat";
  env.GIT_PAGER = "cat";

  return env;
}

export type SpillPolicy = {
  dir: string;
  max: number;
  head: number;
  tail: number;
};

export const createSandBox = ({
  workingDirectory,
  spill,
  toolPath,
}: {
  workingDirectory: string;
  spill: SpillPolicy;
  /**
   * Directories appended to the shell's PATH for tools the app ships with.
   * Appended, not prepended, so a copy the user installed wins.
   */
  toolPath?: string[];
}): Sandbox => {
  const cwd = pathResolve(workingDirectory);
  const extraPath = (toolPath ?? []).filter(Boolean).join(":");
  const res = (p: string) =>
    p.startsWith("/") || /^[A-Za-z]:/.test(p) ? p : pathResolve(cwd, p);

  // A very simple glob → regex. Only **/, * and ? are supported
  const globToRe = (g: string) =>
    new RegExp(
      "^" +
        g
          .replace(/[.+^${}()|[\]\\]/g, "\\$&")
          .replace(/\*\*\//g, "(?:.*/)?")
          .replace(/\*/g, "[^/]*")
          .replace(/\?/g, "[^/]") +
        "$",
    );

  return {
    cwd,
    resolve: res,

    readFile: (p, enc) => readFile(res(p), enc),

    async writeFile(p, content) {
      const full = res(p);
      await mkdir(join(full, ".."), { recursive: true });
      await writeFile(full, content);
    },

    readdir: (p, opts) => readdir(res(p), opts) as any,

    fold: (text, name = "output") => foldLong(text, name, cwd, spill),

    async glob(pattern, { path = ".", limit = 200 } = {}) {
      const root = res(path);
      const re = globToRe(pattern);
      const out: string[] = [];
      for await (const f of walkFiles(root)) {
        const rel = relative(root, f).split(sep).join("/");
        if (re.test(rel) || re.test(f)) out.push(f);
        if (out.length >= limit) break;
      }
      return out;
    },

    exec(command, { cwd: c, timeoutMs = EXEC_TIMEOUT_MS, signal, env } = {}) {
      return new Promise((resolve) => {
        const base = shellEnv();
        if (extraPath) base.PATH = `${base.PATH ?? ""}:${extraPath}`;
        const child = spawn(command, {
          shell: true,
          cwd: c ? res(c) : cwd,
          env: { ...base, ...env },
          // Own process group: with `shell: true` the real work is a child of
          // /bin/sh, and signalling only the shell leaves it running
          detached: true,
        });
        let stdout = "",
          stderr = "";
        child.stdout?.on("data", (d) => (stdout += d));
        child.stderr?.on("data", (d) => (stderr += d));

        const group = (name: NodeJS.Signals) => {
          try {
            // A negative pid means the group: the shell and everything under it
            if (child.pid) process.kill(-child.pid, name);
          } catch {
            // Already gone, or no process groups on this platform
            child.kill(name);
          }
        };

        let settled = false;
        let killing: ReturnType<typeof setTimeout> | undefined;
        let letGo: ReturnType<typeof setTimeout> | undefined;

        const done = async (result: ExecResult) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          clearTimeout(killing);
          clearTimeout(letGo);
          signal?.removeEventListener("abort", onAbort);
          resolve({
            ...result,
            stdout: await foldLong(result.stdout, "stdout", cwd, spill),
            stderr: await foldLong(result.stderr, "stderr", cwd, spill),
          });
        };

        const stop = (why: string) => {
          if (killing || settled) return;
          stderr += `\n[${why}]`;
          group("SIGTERM");
          // A command that ignores SIGTERM would hold its step, and everything
          // waiting on the job, for good (config EXEC_KILL_GRACE_MS)
          killing = setTimeout(() => {
            stderr += "\n[Killed: it did not exit on SIGTERM]";
            group("SIGKILL");
            // Output held open by a process that left the group never closes;
            // what arrived by now is the result
            letGo = setTimeout(() => {
              child.stdout?.destroy();
              child.stderr?.destroy();
              void done({ stdout, stderr, exitCode: -1 });
            }, 1_000);
          }, EXEC_KILL_GRACE_MS);
        };

        const timer = setTimeout(
          () => stop(`Timed out after ${timeoutMs}ms`),
          timeoutMs,
        );

        const onAbort = () => stop("Aborted");
        if (signal?.aborted) onAbort();
        else signal?.addEventListener("abort", onAbort, { once: true });

        child.on("close", (code) =>
          done({ stdout, stderr, exitCode: code ?? -1 }),
        );
        child.on("error", (error) =>
          done({ stdout, stderr: stderr + String(error), exitCode: -1 }),
        );
      });
    },
  };
};

/** Head, a line saying where the rest went, tail. The model reads the file with `sed -n`. */
async function foldLong(
  text: string,
  name: string,
  workspace: string,
  policy: SpillPolicy,
): Promise<string> {
  if (text.length <= policy.max) return text;

  const dir = join(workspace, policy.dir);
  const file = join(
    dir,
    `${new Date().toISOString().replace(/[:.]/g, "-")}-${name.replace(/[^a-zA-Z0-9_-]+/g, "_")}.txt`,
  );
  let where = file;
  try {
    await mkdir(dir, { recursive: true });
    await writeFile(file, text);
    where = relative(workspace, file) || file;
  } catch {
    // Spill failed; the text is still cut
    where = "(could not be written to a file)";
  }

  const lines = (text.match(/\n/g)?.length ?? 0) + 1;
  return `${text.slice(0, policy.head).trimEnd()}\n\n[${name} cut at ${policy.max.toLocaleString("en")} chars — the whole thing (${lines} lines) is at ${where}. Read the part you need with \`sed -n\`.]\n\n${text.slice(-policy.tail).trimStart()}`;
}
