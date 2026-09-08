/**
 * Baked-in knobs: names, roots, paths, limits. Nothing here is a secret or
 * user-settable; that lives in features/config.
 */

/** Only the log level reads this (lib/logger). */
export const IS_DEV = process.env.NODE_ENV === "development";

export const APP_NAME = "Thursday";

/**
 * The app's own files (build, migrations, shipped skills). `THURSDAY_APP_DIR`
 * overrides; defaults to the cwd.
 */
export const APP_DIR = process.env.THURSDAY_APP_DIR?.trim() || process.cwd();

/**
 * The user's files (database, workspace, installed skills). `THURSDAY_HOME`
 * overrides; defaults to the cwd. Never touched by an upgrade.
 */
export const DATA_DIR = process.env.THURSDAY_HOME?.trim() || process.cwd();

/**
 * Where the browser reaches this app: `THURSDAY_URL`, else localhost on `PORT`
 * (default 3000). Used as the MCP OAuth redirect URL, which fails silently
 * after login when wrong.
 */
export const APP_URL =
  process.env.THURSDAY_URL?.trim() ||
  `http://localhost:${process.env.PORT?.trim() || 3000}`;

/** libsql URL. Absolute because the process may not run inside DATA_DIR. */
export const DB_FILE_NAME = `file:${DATA_DIR}/local.db`;

/**
 * Relative paths; readers join them with the root that owns them (APP_DIR for
 * the app's, DATA_DIR for the user's).
 */
// Dot-prefixed so it never reads as part of the app.
const WORKSPACE = ".ai-workspace";

export const PATHS = {
  workspace: WORKSPACE,
  /**
   * Workspace folders a bot may write into, relative to the workspace:
   * `artifacts` finished results the user opens, `projects` code the bot keeps
   * building, `scratch` everything in progress. The workspace root is refused.
   */
  artifacts: "artifacts",
  projects: "projects",
  scratch: "scratch",
  /** Where tool output over TOOL_OUTPUT is written in full. */
  output: ".output",
  skills: {
    default: "skills", // ships with the app, read-only
    // The user's own, inside the workspace; where `npx skills add` installs.
    custom: `${WORKSPACE}/.agents/skills`,
  },
};

/** Rows per page for every scrolling list. */
export const PAGE_SIZE = 50;

/**
 * Cap on the text a single tool result returns to the model (chars). Beyond
 * `max`, only `head` + `tail` are kept and the full text goes to PATHS.output.
 * Shell output and MCP results share it.
 */
export const TOOL_OUTPUT = { max: 8_000, head: 5_500, tail: 1_500 };

/**
 * Limits on one bot run (features/bot/bot.run).
 * - `steps`  steps per segment; at the limit the last step is forced to `report`
 *            and the job waits for the user to continue.
 * - `compactAt`  context size in tokens at which the run compacts: the model
 *            summarizes the thread so far and continues from that summary.
 *            Must stay below the model's window.
 * - `summaryWords`  summary length: one word per `perTokens` of budget, clamped
 *            to `min`..`max`.
 * - `resumeMessages`  messages re-read after the last compact when resuming.
 */
export const BOT_RUN = {
  steps: 40,
  compactAt: 120_000,
  summaryWords: { min: 600, max: 3000, perTokens: 200 },
  resumeMessages: 20,
};

/** Name of the shipped browser skill (PATHS.skills.default); a seed bot claims it by name. */
export const BROWSER_SKILL = "browser";

/**
 * Size of the browser a job drives (workspace.ts jobShellEnv). A headed window
 * takes this, and it opens over whatever the user is doing — big enough to read
 * a real page, small enough not to be the screen.
 */
export const BROWSER_VIEWPORT = "1100x800";

/**
 * Name of the built-in "server" holding media tools (image, TTS, STT, video),
 * exposed to bots like an MCP server (features/ai/tools/connected). Shared so
 * connectors can refuse registering a real server under this name.
 */
export const STUDIO_SERVER = "studio";

/**
 * How much of the previous call the prompt carries verbatim: `rows` turns are
 * fetched, then filled newest-first until `tokens` is spent.
 */
export const RECENT_CALL = { rows: 20, tokens: 600 };

/**
 * The memory tidy pass (features/memory/memory.tidy): a text model re-reads
 * calls after the fact and reconciles memory with them.
 * - `threshold`  pending transcript tokens (user and assistant turns of calls
 *            not yet read) at which a pass starts, per setting level.
 * - `quietMs`  how long after a call ends, with no new call, before a pass may start.
 * - `staleDays`  a pass starts regardless of size once the oldest pending call is this old.
 * - `maxCalls`  calls one pass reads; the rest wait for the next.
 * - `unitTokens`  transcript tokens one model context takes; a longer call is
 *            read in parts.
 * - `steps`  model steps per part.
 */
export const MEMORY_TIDY = {
  threshold: { often: 4_000, normal: 8_000, rarely: 20_000 },
  quietMs: 3 * 60_000,
  staleDays: 3,
  maxCalls: 10,
  unitTokens: 20_000,
  steps: 12,
};

/**
 * How long the event stream may have no browser on it before the app treats
 * the browser as closed and stops what it was doing (app/api/events presence).
 * Long enough to cover a reload or a route change.
 */
export const BROWSER_GONE_MS = 10_000;

/** Memory listing size (tokens) above which the prompt asks for tidying. */
export const MEMORY_LISTING_TOKENS = 1_000;

/** Max chars for one listing line in a prompt. */
export const PROMPT_LINE = {
  /** First sentence of a skill description; bots get the full text. */
  skill: 90,
  /** Tool-call arguments; file contents or prompts may arrive as arguments. */
  toolArgs: 30,
};
