import {
  mkdir,
  readdir,
  realpath,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import {
  APP_DIR,
  BROWSER_VIEWPORT,
  DATA_DIR,
  PATHS,
  TOOL_OUTPUT,
} from "@/config";
import { logger } from "@/lib/logger";
import { createSandBox, type Sandbox } from "@/lib/sandbox";

/**
 * Where the sandbox is opened. The app's own skills live outside the
 * workspace so nothing running in it can rewrite them; the user's skills are
 * under `.agents/skills`, where the `skills` CLI installs to.
 */

/** The app itself is off limits; not the workspace folder once installed (APP_DIR / DATA_DIR). */
const APP_ROOT = APP_DIR;

/** Everything the agent writes is under here. */
export const WORKSPACE = join(DATA_DIR, PATHS.workspace);

/** The shell's tool path: `THURSDAY_TOOL_PATH`, else the app's own node_modules/.bin (playwright-cli). */
const TOOL_PATH = (
  process.env.THURSDAY_TOOL_PATH?.split(":") ?? [
    join(APP_ROOT, "node_modules", ".bin"),
  ]
).filter(Boolean);

export const ARTIFACTS = join(WORKSPACE, PATHS.artifacts);

/**
 * Created on open, and the only places inside the workspace `write_file`
 * accepts. `.agents` is the skills CLI's install folder.
 */
const BOT_FOLDERS = [PATHS.artifacts, PATHS.projects, PATHS.scratch];
const WRITABLE = new Set([...BOT_FOLDERS, ".agents"]);

/** Where playwright-cli drops a snapshot after every command. Its name, not ours. */
const BROWSER_DIR = ".playwright-cli";

const under = (root: string, path: string) =>
  path === root || path.startsWith(root + sep);

/**
 * Why a file may not be written where the model asked, as one line it can act
 * on, or null when it may. Refused: the workspace root (files belong in one
 * of the three folders) and anything inside the app running the bot.
 */
export function writeRefusal(full: string): string | null {
  if (under(WORKSPACE, full)) {
    const rel = relative(WORKSPACE, full);
    const [top] = rel.split(sep);
    if (top && WRITABLE.has(top)) return null;
    return `Not written: ${rel || "the workspace root"} is outside the workspace's folders. Finished work goes under ${PATHS.artifacts}/, code under ${PATHS.projects}/, everything else under ${PATHS.scratch}/.`;
  }
  if (under(APP_ROOT, full)) {
    return `Not written: ${full} is inside the app that is running you, not the user's files. Work in ${WORKSPACE}; outside it, write only where the user pointed you.`;
  }
  return null;
}

const realOrNull = (path: string) => realpath(path).catch(() => null);

export async function insideWorkspace(rel: string): Promise<string | null> {
  const root = (await realOrNull(WORKSPACE)) ?? WORKSPACE;
  const full = resolve(WORKSPACE, rel);
  if (!under(WORKSPACE, full)) return null;

  let probe = full;
  let real = await realOrNull(probe);
  while (real === null && dirname(probe) !== probe) {
    probe = dirname(probe);
    real = await realOrNull(probe);
  }
  if (real === null) return null;

  const rest = relative(probe, full);
  const target = rest ? join(real, rest) : real;
  return under(root, target) ? target : null;
}

/**
 * A job's own browser session. playwright-cli reads the session name from
 * this variable when `-s=` is not given, so the model never picks one and the
 * runner can close exactly this session when the job ends.
 */
export const jobShellEnv = (
  taskId: string | null | undefined,
): Record<string, string> =>
  taskId
    ? {
        PLAYWRIGHT_CLI_SESSION: `task-${taskId}`,
        // Read by playwright-cli; the window it opens is on the user's screen
        PLAYWRIGHT_MCP_VIEWPORT_SIZE: BROWSER_VIEWPORT,
      }
    : {};

/** Set by `ensureBrowser`, read by `readMachineTools`; null until it has finished. */
let browserReady: boolean | null = null;

/**
 * What the shell can actually reach. A bot writes a job around what is here —
 * node or python3, which package manager — and the platform does not say: two
 * macs differ. Probed in one `command -v` sweep at the moment it is asked, per
 * job rather than cached, so a job that installs something is not told
 * otherwise on its next run.
 */
export const PROBED = {
  runtimes: ["node", "python3", "uv", "bun", "deno"],
  managers: ["pnpm", "npm", "yarn"],
} as const;

export type MachineTools = {
  [K in keyof typeof PROBED]: { found: string[]; missing: string[] };
} & {
  /** Null while `ensureBrowser` is still running; it starts at boot and is not awaited. */
  browser: boolean | null;
};

export async function readMachineTools(
  sandbox: Sandbox,
): Promise<MachineTools> {
  const names = Object.values(PROBED).flat();
  const { stdout } = await sandbox.exec(
    names
      .map(
        (name) => `command -v ${name} >/dev/null 2>&1 && printf '%s ' ${name}`,
      )
      .join("; "),
    { timeoutMs: 10_000 },
  );
  const found = new Set(stdout.trim().split(/\s+/).filter(Boolean));
  const split = (list: readonly string[]) => ({
    found: list.filter((name) => found.has(name)),
    missing: list.filter((name) => !found.has(name)),
  });
  return {
    runtimes: split(PROBED.runtimes),
    managers: split(PROBED.managers),
    browser: browserReady,
  };
}

/**
 * The browser bots drive. It is not in the package — ~280 MB, and its build
 * moves with playwright-core — so it is fetched here instead of from an install
 * script: nothing may stand between `npx` and a running app, and a first run
 * spends its first minute on the intro anyway. Started at boot and not awaited
 * (instrumentation); already installed, it costs about a fifth of a second.
 * A bot that still finds no browser has the same command in the browser skill.
 */
export async function ensureBrowser(): Promise<void> {
  if (process.env.THURSDAY_SKIP_BROWSER) return;

  const sandbox = await openWorkspace();
  // The shell a job would use, so a browser reachable here is reachable there
  const done = await sandbox
    .exec("playwright-cli install-browser chromium")
    .catch((cause: unknown) => ({ exitCode: 1, stderr: String(cause) }));

  browserReady = done.exitCode === 0;
  if (browserReady) return;
  logger.warn(
    `no browser — bots cannot open a page until \`playwright-cli install-browser chromium\` succeeds: ${done.stderr.trim().split("\n").at(-1) ?? ""}`,
  );
}

export async function closeJobShell(taskId: string): Promise<void> {
  const sandbox = await openWorkspace();
  await sandbox
    .exec("playwright-cli close", {
      env: jobShellEnv(taskId),
      timeoutMs: 15_000,
    })
    .catch(() => {});
  await pruneBrowserFiles();
}

/**
 * playwright-cli never deletes its snapshot files. Refs go stale on the next
 * click, so anything older than an hour belongs to no running job.
 */
const BROWSER_FILE_TTL_MS = 60 * 60 * 1000;

async function pruneBrowserFiles(): Promise<void> {
  const dir = join(WORKSPACE, BROWSER_DIR);
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  const cutoff = Date.now() - BROWSER_FILE_TTL_MS;
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const file = join(dir, entry.name);
    const info = await stat(file).catch(() => null);
    if (info && info.mtimeMs < cutoff) await unlink(file).catch(() => {});
  }
}

/**
 * pnpm looks upward for the nearest `pnpm-workspace.yaml`; without one here a
 * `pnpm install` inside a bot project would join the app's workspace and
 * rewrite the app's lockfile. Neither `.npmrc` nor an env var prevents that.
 * `recursive-install=false` keeps one project's install from installing all.
 * Written only when missing; the agent may edit them afterwards.
 */
const FENCE: Record<string, string> = {
  "pnpm-workspace.yaml": "packages:\n  - '**'\n",
  ".npmrc": "recursive-install=false\n",
};

export async function openWorkspace(): Promise<Sandbox> {
  for (const folder of BOT_FOLDERS) {
    await mkdir(join(WORKSPACE, folder), { recursive: true });
  }
  for (const [name, content] of Object.entries(FENCE)) {
    // `wx`: create only if absent, never overwrite
    await writeFile(join(WORKSPACE, name), content, { flag: "wx" }).catch(
      () => {},
    );
  }
  return createSandBox({
    workingDirectory: WORKSPACE,
    spill: { dir: PATHS.output, ...TOOL_OUTPUT },
    toolPath: TOOL_PATH,
  });
}
