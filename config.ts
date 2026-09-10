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
   * Workspace folders a bot may write into, relative to the workspace. They are
   * split by how long what is in them lives: `artifacts` finished results the
   * user opens and `projects` code that outlives any one job are the user's and
   * stay; `scratch/<job>` dies with the job that made it; `bots/<name>` lasts as
   * long as the bot. The workspace root is refused.
   */
  artifacts: "artifacts",
  projects: "projects",
  scratch: "scratch",
  /**
   * A bot's own corner, one folder per bot. Its notes are prose and capped; this
   * is where the rest goes — a script it wrote once and reuses, a table it built,
   * anything worth having on the next job. Kept apart from `scratch` because the
   * two die at different times: a job's material dies with the job, a bot's kit
   * lives as long as the bot.
   */
  bots: "bots",
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

/** History page size in calls, not rows; each call carries every turn. */
export const CALL_HISTORY_PAGE = 10;

/**
 * Turns per page when a model opens the conversation a fact was saved in
 * (ai/tools/memory.tool `memory_conversation`). A whole call nearly always
 * fits one page; the page is there so an hour-long call cannot arrive at once.
 */
export const MEMORY_CONVERSATION_PAGE = 100;

/**
 * The Workspace section (features/workspace), which browses what bots wrote.
 * - `rows`  entries one folder listing returns; the rest load on demand. Only
 *           the ones returned are `stat`ed, so a folder of 20,000 files costs
 *           the same readdir as a folder of 20.
 * - `textMax`  text handed to a page or a dialog. Past it only the head is
 *           read and the view says so; the whole file stays behind Download.
 * - `elementMax`  an image or page drawn as an element. Past it nothing is
 *           drawn: an `<img>` decodes whole and a huge DOM cannot be scrolled.
 *           Audio and video are not capped — they stream over Range.
 */
export const WORKSPACE_VIEW = {
  rows: 200,
  textMax: 512 * 1024,
  elementMax: 50 * 1024 * 1024,
};

/**
 * The Artifacts section (features/artifact), which lists the top of
 * `artifacts/` — one entry there is one artifact.
 * - `rows`  entries the menu returns; the rest load on demand.
 * - `setFiles`  files one opened set draws before the sheet asks for more.
 * What the browser is handed is capped by WORKSPACE_VIEW: the two sections
 * open files with the same reader.
 */
export const ARTIFACT_VIEW = { rows: 200, setFiles: 120 };

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
 * - `depth`  how deep `ask_bot` may go. A borrowed bot cannot borrow another.
 * - `askBack`  `ask_back` calls a borrowed bot gets per part. At zero the tool
 *            is removed rather than left to refuse.
 */
export const BOT_RUN = {
  steps: 30,
  compactAt: 120_000,
  summaryWords: { min: 600, max: 3000, perTokens: 200 },
  resumeMessages: 20,
  depth: 1,
  askBack: 3,
};

/**
 * A bot's own notes (database bot_note): one block of prose it writes to itself, at most
 * this many characters. One block and not a list, because it is read as instructions — the
 * bot's own, under the owner's. A ceiling, not a target: most bots never approach it.
 * `steps` is the rewrite pass: one call is the whole job, the rest headroom for
 * a rejected argument list (features/bot/bot.notes).
 */
export const BOT_NOTES = { chars: 400, steps: 3 };

/** Name of the shipped browser skill (PATHS.skills.default); a seed bot claims it by name. */
export const BROWSER_SKILL = "browser";

/**
 * Size of the browser a job drives (workspace.ts jobShellEnv). A headed window
 * takes this, and it opens over whatever the user is doing — big enough to read
 * a real page, small enough not to be the screen.
 */
export const BROWSER_VIEWPORT = "700x700";

/**
 * How long one shell command may run before it is killed (lib/sandbox). Nothing
 * is watching it, so a command that stops to ask never gets an answer; the
 * number is said in the shell guide a bot reads (ai/tools/workspace.tool).
 */
export const EXEC_TIMEOUT_MS = 180_000;

/**
 * Name of the built-in "server" holding media tools (image, TTS, STT, video),
 * exposed to bots like an MCP server (features/ai/tools/connected). Shared so
 * connectors can refuse registering a real server under this name.
 */
export const STUDIO_SERVER = "studio";

/**
 * How long what a job left behind stays (features/workspace/workspace).
 * - `snapshotsMs`  playwright-cli never deletes its snapshots, and refs go
 *            stale on the next click, so anything older belongs to no job.
 * - `outputMs`  tool output over `TOOL_OUTPUT.max` is written out in full;
 *            long enough to still be looking, short enough that the folder
 *            does not become the biggest thing in the workspace.
 */
export const WORKSPACE_KEEP = {
  snapshotsMs: 60 * 60 * 1000,
  outputMs: 24 * 60 * 60 * 1000,
};

/**
 * How much of the previous call the prompt carries verbatim: `rows` turns are
 * fetched, then filled newest-first until `tokens` is spent.
 */
export const RECENT_CALL = { rows: 20, tokens: 600 };

/**
 * How long the event stream may have no browser on it before the app treats
 * the browser as closed and stops what it was doing (app/api/events presence).
 * Long enough to cover a reload or a route change.
 */
export const BROWSER_GONE_MS = 10_000;

/**
 * Size of one assembled prompt (tokens) past which the log names the chapter
 * carrying it. Not a cap — every chapter is there because something needs it —
 * but growth is in the listings (memory, skills, connected tools, bots), which
 * belong to the user, so nothing else would ever notice. Roughly twice a
 * well-used install.
 */
export const PROMPT_BUDGET = 6_000;

/**
 * What counts as too much memory to hold in one piece (features/memory), counted
 * in facts. Nothing truncates: the first two put a line in the call prompt asking
 * her to sort it out with the user before she raises anything else, and the third
 * is the only hard one. Facts rather than tokens because it is the number the user
 * sees on their own screen and the number a model is told after every write — a
 * token estimate is nobody's unit and cannot be acted on.
 * - `facts`  facts held across every note, above which the listing is too long.
 * - `factsPerNote`  facts in one note, above which that note is named instead.
 * - `carried`  facts loaded into every prompt without opening a note; enforced
 *            by the write path, which refuses the next one.
 */
export const MEMORY_LIMITS = {
  facts: 400,
  factsPerNote: 50,
  carried: 20,
};

/**
 * How many bots or skills may pile up before the screen says what they cost.
 * Every one of either is a line in every prompt assembled afterwards — measured,
 * a skill runs about 43 tokens in a bot's prompt and a roster entry about 48 —
 * so a long list is paid for on every call and every job, and a model picking
 * from it has more to read past. Not a cap: the screen states the cost and the
 * user decides.
 */
export const PROMPT_CROWDED = { bots: 10, skills: 20 };

/** Max chars for one listing line in a prompt. */
export const PROMPT_LINE = {
  /** First sentence of a skill description; bots get the full text. */
  skill: 90,
  /** Tool-call arguments; file contents or prompts may arrive as arguments. */
  toolArgs: 30,
  /** A past job's answer in the transcript; the rest is asked for with `task`. */
  jobOutcome: 160,
  /** One call turn travelling with a job in its opening message. */
  callTurn: 160,
};
