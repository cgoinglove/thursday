import {
  mkdir,
  readdir,
  realpath,
  rm,
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
  WORKSPACE_KEEP,
} from "@/config";
import { logger } from "@/lib/logger";
import { createSandBox, type Sandbox, walkFiles } from "@/lib/sandbox";

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
const BOT_FOLDERS = [
  PATHS.artifacts,
  PATHS.projects,
  PATHS.scratch,
  PATHS.bots,
];
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
    return `Not written: ${rel || "the workspace root"} is outside the workspace's folders. Finished work goes under ${PATHS.artifacts}/, code under ${PATHS.projects}/, your own kit under ${PATHS.bots}/, and this job's working material under ${PATHS.scratch}/.`;
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
 * Where one job keeps what it is still working on. `scratch/` used to be shared
 * by every job at once, so nobody could tell whose a file was or when it stopped
 * mattering, and it only grew. A job has a beginning and an end, which is what
 * makes its working material safe to clear later — and it is the right unit
 * rather than the bot, because several bots work inside one job (`ask_bot`) and
 * one bot runs many jobs.
 *
 * Named for the label so the folder is readable on the Workspace screen, with
 * the head of the id after it so two jobs called the same thing stay apart.
 * Finished work never lands here: that is `artifacts/`, which stays flat and
 * unattributed, and code is `projects/`, which outlives the job that started it.
 */
export function jobScratch(taskId: string, label: string): string {
  const slug =
    label
      .trim()
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "job";
  return `${PATHS.scratch}/${slug}-${taskId.slice(0, 6)}`;
}

/** Where one bot keeps what it wants on its next job (config PATHS.bots). */
export const botFolder = (bot: string): string =>
  `${PATHS.bots}/${bot.replace(/[^\p{L}\p{N}_-]+/gu, "-")}`;

export async function openBotFolder(bot: string): Promise<string> {
  const path = botFolder(bot);
  await mkdir(join(WORKSPACE, path), { recursive: true });
  return path;
}

/** Creates it, so a job never has to and never writes to the shared root by mistake. */
export async function openJobScratch(
  taskId: string,
  label: string,
): Promise<string> {
  const path = jobScratch(taskId, label);
  await mkdir(join(WORKSPACE, path), { recursive: true });
  return path;
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

/** What a job leaves on disk: stale browser snapshots and spilled tool output. */
export async function pruneJobFiles(): Promise<void> {
  await pruneBrowserFiles();
  await pruneOutputFiles();
}

type ListedBrowser = { name: string; headed?: boolean; attached?: boolean };

/**
 * A job that ended closes the browser nobody can see. Headless is the bot's
 * working copy; `--headed` is the bot putting a window on their screen on
 * purpose — an order at checkout, a map with a pin, a sign-in — and that one is
 * theirs to close (`skills/browser`). A session attached to their own Chrome is
 * never touched. Anything unreadable — no playwright, a failed or folded `list`
 * — leaves the browser as it is.
 */
export async function closeHiddenBrowser(taskId: string): Promise<void> {
  const sandbox = await openWorkspace();
  const env = jobShellEnv(taskId);
  const listed = await sandbox
    .exec("playwright-cli list --json", { env, timeoutMs: 15_000 })
    .catch(() => null);
  let session: ListedBrowser | undefined;
  try {
    const { browsers } = JSON.parse(listed?.stdout ?? "") as {
      browsers?: ListedBrowser[];
    };
    session = browsers?.find((b) => b.name === env.PLAYWRIGHT_CLI_SESSION);
  } catch {}
  if (session?.headed === false && !session.attached) {
    await sandbox
      .exec("playwright-cli close", { env, timeoutMs: 15_000 })
      .catch(() => {});
  }
  await pruneJobFiles();
}

/**
 * Closes the job's browser whatever it shows. Only for a job the user cancelled
 * or deleted: its row is gone, so a window left open would belong to nothing on
 * the screen.
 */
export async function closeJobShell(taskId: string): Promise<void> {
  const sandbox = await openWorkspace();
  await sandbox
    .exec("playwright-cli close", {
      env: jobShellEnv(taskId),
      timeoutMs: 15_000,
    })
    .catch(() => {});
  await pruneJobFiles();
}

async function pruneOutputFiles(): Promise<void> {
  const dir = join(WORKSPACE, PATHS.output);
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  const cutoff = Date.now() - WORKSPACE_KEEP.outputMs;
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const file = join(dir, entry.name);
    const info = await stat(file).catch(() => null);
    if (info && info.mtimeMs < cutoff) await unlink(file).catch(() => {});
  }
}

async function pruneBrowserFiles(): Promise<void> {
  const dir = join(WORKSPACE, BROWSER_DIR);
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  const cutoff = Date.now() - WORKSPACE_KEEP.snapshotsMs;
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

/** Files read off one job's folder at most; a folder of generated files is not a list anyone reads. */
const JOB_FOLDER_WALK = 500;

/**
 * What of a job's files is on disk: the paths it gave `write_file` that still exist,
 * and every file under its own folder however it got there — a shell command, a
 * download, a screenshot. Workspace-relative where inside the workspace, each once,
 * the most recently changed last (bot.run filesUnder).
 */
export async function filesOnDisk(
  written: string[],
  folder: string | null,
): Promise<string[]> {
  const candidates = written.map((path) => resolve(WORKSPACE, path));
  if (folder) {
    let walked = 0;
    for await (const full of walkFiles(join(WORKSPACE, folder))) {
      candidates.push(full);
      walked += 1;
      if (walked >= JOB_FOLDER_WALK) break;
    }
  }
  const found = new Map<string, number>();
  for (const full of candidates) {
    const info = await stat(full).catch(() => null);
    if (!info?.isFile()) continue;
    const rel = relative(WORKSPACE, full);
    found.set(rel && !rel.startsWith("..") ? rel : full, info.mtimeMs);
  }
  return [...found].sort((a, b) => a[1] - b[1]).map(([path]) => path);
}

/**
 * Removes a job's working folder. Its lifetime is the task's: when the row goes,
 * so does what it was working with (features/bot/bot.runner). Never touches
 * `artifacts` or `projects` — those are the user's and outlive every job.
 */
export async function removeJobScratch(
  taskId: string,
  label: string,
): Promise<void> {
  await rm(join(WORKSPACE, jobScratch(taskId, label)), {
    recursive: true,
    force: true,
  }).catch(() => {});
}
