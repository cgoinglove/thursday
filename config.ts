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
 * Where the browser reaches this app: `THURSDAY_URL`, else localhost on `PORT`,
 * which both starters set to the free port they found (bin/port.mjs). Used as
 * the MCP OAuth redirect URL, which fails silently after login when wrong.
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
   * stay; `scratch/<job>` goes with its job, or once the job has ended
   * WORKSPACE_KEEP ago; `bots/<name>` lasts as long as the bot. The workspace
   * root is refused.
   */
  artifacts: "artifacts",
  projects: "projects",
  scratch: "scratch",
  /**
   * A bot's own corner, one folder per bot: its memory (`memory/`, features/bot/bot.memory),
   * a sign-in it kept, a script it wrote once and reuses, a table it built — anything
   * worth having on the next job. Kept apart from `scratch` because the two die at
   * different times: a job's material dies with the job, a bot's kit lives as long as
   * the bot.
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

/**
 * Finished jobs the inbox carries beside everything still running or waiting.
 * The room in the call screen's corner and the Tasks badge read that one list,
 * so this is also the most unopened answers the badge can owe: one more ending
 * pushes the oldest off both, still unread in Settings › Tasks.
 */
export const INBOX_FINISHED = 3;

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
 * - `steps`  steps per segment; at the limit the last step is forced to `answer`
 *            and the job waits for the user to continue.
 * - `compactAt`  context size in tokens at which the run compacts when the model's
 *            window cannot be known (model.ts compactBudget asks the gateway's
 *            catalog, and a provider used directly carries one per model). Set
 *            for the windows current models carry: a smaller model the app
 *            knows nothing about can reach its limit first, and its refusal
 *            then lowers that job's own threshold (`overflowShrink`).
 * - `compactHeadroom`  fraction of a known window used as the budget. Not
 *            tidiness: the summarising call sends the whole context plus its
 *            instructions and must get a summary back, so it needs room above
 *            the threshold that triggered it.
 * - `summaryWords`  summary length: one word per `perTokens` of budget, clamped
 *            to `min`..`max`.
 * - `depth`  how many hand-offs `ask_bot` may go below the bot holding the job:
 *            2 is that bot, one it borrows, and one that bot borrows. The last
 *            seat has no `ask_bot`, and no seat may borrow a bot above it.
 * - `askBack`  `ask_back` calls a borrowed bot gets per part. At zero the tool
 *            is removed rather than left to refuse.
 * - `silenceMs`  how long a model call may send nothing before the run takes the
 *            connection for dead and stops (bot.run silenceWatch). Not counted
 *            while a tool or a compaction does the work; those bound themselves.
 *            A model that thinks before its first word is silent that long, so
 *            this is minutes. A one-shot call (compaction, answering `ask_back`)
 *            sends nothing until it is done and gets it whole.
 * - `autoResumes`  times a job the app stopped — a restart, a closed browser, a
 *            model call a retry or a compaction can fix — picks itself back up.
 *            Counted since a person last spoke to it, so a job that keeps taking
 *            the server down stops and waits for a person instead.
 * - `retryAfterMs`  wait before each of those resumes after a failed model
 *            call, by how many came before. A restart or a closed browser resumes
 *            as soon as a browser is on the app.
 * - `overflowShrink`  what a job's compaction threshold is multiplied by when the
 *            model refuses its context as too long, so the resume compacts first.
 * - `compactFiles`  files the app lists under a compaction summary — what the job
 *            has on disk, the newest kept (bot.run filesUnder). Past it the list
 *            says how many older ones there are; all of them stay in the Workspace.
 */
export const BOT_RUN = {
  steps: 100,
  compactAt: 500_000,
  compactHeadroom: 0.8,
  summaryWords: { min: 600, max: 3000, perTokens: 200 },
  depth: 2,
  askBack: 3,
  silenceMs: 5 * 60_000,
  autoResumes: 3,
  retryAfterMs: [30_000, 120_000, 300_000],
  overflowShrink: 0.6,
  compactFiles: 40,
};

/**
 * How many files of a bot's own memory (`bots/<name>/memory/`, features/bot/bot.memory) its
 * prompt lists, newest first, one line each. Every line is paid on every step of every job
 * that bot runs; a file past the count stays on disk and the listing says how to reach it.
 * Raising it shows more of a long memory for more tokens on each of those steps.
 */
export const BOT_MEMORY_LISTED = 20;

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
 * How long one shell command may run during a call (ai/load-tools, the call's
 * `bash`). The mic is closed while a tool runs, so this is how long one command
 * can hold the call silent; anything slower is a job for a bot. Raising it lets
 * the call run slower commands itself, and keeps the line quiet that much longer.
 */
export const CALL_EXEC_TIMEOUT_MS = 15_000;

/**
 * How long a shell command that was stopped — its timeout, or its job stopping —
 * gets to exit on SIGTERM before its whole process group is killed (lib/sandbox).
 * A command that ignores the first signal would otherwise hold its step, and
 * everything waiting on the job, for good.
 */
export const EXEC_KILL_GRACE_MS = 5_000;

/**
 * Name of the built-in "server" holding media tools (image, TTS, STT, video),
 * exposed to bots like an MCP server (features/ai/tools/connected). Shared so
 * connectors can refuse registering a real server under this name.
 */
export const STUDIO_SERVER = "studio";

/**
 * How long one connected tool — an MCP server's, or the studio's — may take before
 * it is given up on and the model told so (features/ai/tools/connected). Nothing else
 * bounds it: the MCP client waits forever by default. A video model is the slow end
 * of what is honest.
 */
export const CONNECTED_TOOL_TIMEOUT_MS = 10 * 60_000;

/**
 * How long what jobs leave behind stays before the app clears it by itself
 * (bot.runner sweepJobFiles). Deleting a job clears its folder at once.
 * - `forMs`  one age for all of it: a job's scratch folder, counted from when
 *            the job ended (a job running or waiting keeps its folder however
 *            old), a scratch folder no job owns, spilled tool output, and the
 *            browser's snapshots and logs. Headless participant browsers close
 *            when the ended job's folder expires too. Long enough to return to a job
 *            days later; what is worth keeping goes in `artifacts/`, which is
 *            never cleared.
 * - `sweepEveryMs`  how often the app looks, besides once at boot.
 */
export const WORKSPACE_KEEP = {
  forMs: 3 * 24 * 60 * 60 * 1000,
  sweepEveryMs: 60 * 60 * 1000,
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
 * in facts. Nothing is deleted on its own: past either of the first two a call opens by asking
 * her to sort it out with the user before anything she would raise herself
 * (thursday.prompt tidyOpening), and the third is the only hard one. Facts rather
 * than tokens because it is the number the user sees on their own screen and the
 * number a model is told after every write — a token estimate is nobody's unit and
 * cannot be acted on.
 * - `facts`  facts held across every note, above which the listing is too long.
 * - `factsPerNote`  facts in one note, above which that note is named instead.
 * - `carried`  facts loaded into every call's prompt without opening a note; past
 *            it the write path stores the next one as an ordinary fact and says so.
 * - `expanded`  facts of profile and preferences written out in each call's prompt
 *            without opening them — carried ones first, then the newest. The rest
 *            are counted there and she opens the note for them. Raising it costs
 *            every call up to twice that many lines; bots never see these.
 */
export const MEMORY_LIMITS = {
  facts: 400,
  factsPerNote: 50,
  carried: 20,
  expanded: 10,
};

/**
 * One web search (features/ai/tools/search.tool), Exa or a model's own.
 * - `sources`  hits worth carrying back; past this it is noise.
 * - `excerptChars`  how much of one page rides back with it; a bot that wants
 *            the whole page fetches it.
 * - `timeoutMs`  one deadline for both ways in. Nobody is watching a search, so
 *            a request that never answers would hold the step until the job's
 *            own timeout; a line saying so is worth more than the wait.
 */
export const SEARCH = { sources: 6, excerptChars: 1_200, timeoutMs: 30_000 };

/**
 * At or under this many dollars left on the gateway key, its row in Settings › Keys
 * turns amber (ai/model readGatewayCredits): a video clip or a long job can spend
 * that before it finishes. Raising it warns sooner; 0 warns only once nothing is left.
 */
export const GATEWAY_LOW_CREDIT = 1;

/**
 * Signing in to ChatGPT (features/ai/chatgpt), whose plan runs bots in place of an API key.
 * - `waitMs`  how long the app listens for the sign-in page's answer. Past it the port is
 *            let go and signing in starts over from Config; shorter frees it sooner when
 *            a page is abandoned, too short cuts off someone still typing a password.
 * - `renewBeforeMs`  how long before the access token runs out it is renewed. Too close
 *            to the edge and a request leaves with a token that dies on the way.
 */
export const CHATGPT_SIGN_IN = {
  waitMs: 10 * 60_000,
  renewBeforeMs: 5 * 60_000,
};

/**
 * At or past this share of a GPT Subscription window used, its row in Settings › Keys turns
 * amber (ai/chatgpt readChatGptUsage): a long job can spend the rest before it finishes and
 * then waits for the window to reset. Lower warns sooner; 100 warns only once it is spent.
 */
export const CHATGPT_USAGE_HIGH = 80;

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
  /** The first line a file in a bot's own memory is listed by (config BOT_MEMORY_LISTED). */
  botMemory: 100,
};

/**
 * Thursday's ascii face until a browser keeps one of its own (features/thursday
 * face.store holds the pick in localStorage; Settings › Thursday changes it).
 * The ranges bound both what is stored and the settings sliders.
 * - `charset`  `ascii` draws characters only, `emoji` sprinkles emoji in,
 *            `emojiOnly` draws nothing else. Emoji cost more to draw per frame.
 * - `fontSize`  glyph size in px. Smaller glyphs pack more cells into the same
 *            orb: a finer grain, and more to draw on every frame.
 * - `density`  cells per glyph pitch. Above 1 packs them tighter; below leaves
 *            air between them.
 */
export const ASCII_FACE = {
  charset: "emojiOnly",
  fontSize: { default: 8, min: 4, max: 16 },
  density: { default: 1.4, min: 0.6, max: 2 },
} as const;
