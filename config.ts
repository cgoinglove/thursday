/**
 * Baked-in knobs: names, roots, paths, limits. Nothing here is a secret or
 * user-settable; that lives in features/config.
 */

/** Only the log level reads this (lib/logger). */
export const IS_DEV = process.env.NODE_ENV === "development";

export const APP_NAME = "Thursday";

/**
 * Live call limits. Startup and close deadlines release stalled connections;
 * transcriptGapMs groups nearby fragments for captions, never for tool execution.
 * transcriptSaveMs sets the checkpoint interval; appendMs bounds update acknowledgements.
 * backendOutputTokens bounds each delegated answer, including reasoning tokens.
 * reasoningCheckMs bounds asking whether the backend model takes the chosen reasoning
 * settings, once per model and effort; past it the call opens with them as chosen.
 * keyCheckMs bounds asking OpenAI about a key as it is saved; past it the key is kept
 * unasked, so a slow network never stands between a user and saving one.
 */
export const LIVE_CALL = {
  startupMs: 30_000,
  closeMs: 15_000,
  transcriptGapMs: 1_500,
  transcriptSaveMs: 500,
  appendMs: 15_000,
  backendOutputTokens: 4_096,
  reasoningCheckMs: 5_000,
  keyCheckMs: 5_000,
};

/**
 * Background work put to the voice during a call (useThursday). Live never speaks
 * unprompted, so what waits on the user reaches them only when the page puts it in.
 * Each item goes in once a call; once she has voiced it, not on a later call either,
 * while the page stays open. A job that asks or ends again is a new item.
 * - `quietMs`  how long neither side's words have been transcribed before open work goes
 *   in. Transcripts arrive after the words and the clock looks once a second, so the line
 *   has been quiet a little longer than this. Shorter talks over the user, and at 0 an
 *   update goes in mid-sentence; longer leaves a result that is ready waiting through the
 *   small talk around it.
 * - `perTurn`  how many items of one kind go in at once. More puts several updates in
 *   one breath; fewer spreads them over more quiet moments.
 * - `readMs`  how long an update she never voices holds back the next one. Shorter can
 *   put the next update over one she is about to say; longer stalls the queue.
 * - `chars`  how much of one bot message goes in. A message is written for the screen;
 *   more has her read captions and source lists aloud, fewer drops what a short
 *   answer needed. The rest stays in the thread.
 */
export const CALL_RELAY = {
  quietMs: 2_000,
  perTurn: 3,
  readMs: 15_000,
  chars: 600,
};

/**
 * The activity line under her face (thursday.tsx). A backend that uses three tools in a
 * second reports three lines in a second, and none of them can be read.
 * - `dwellMs`  the least time one line is drawn before the next takes its place; the ones
 *   behind it wait their turn. Longer reads better and runs further behind the work; her
 *   voice starting drops whatever still waits, since it is the answer those lines led to.
 */
export const CALL_LINE = { dwellMs: 2_000 };

/**
 * When a quiet call ends itself (useThursday).
 * - `hangUpMs`  how long the user has said nothing and she has neither spoken nor worked
 *   before the page hangs up, with no goodbye. Updates she voices on her own (CALL_RELAY) do
 *   not count, so waiting results cannot hold a call open, and neither do sounds transcribed
 *   in brackets ("[sigh]"). Noise transcribed as words does.
 * - `warnMs`  how much of `hangUpMs` counts down on screen.
 */
export const CALL_IDLE = {
  hangUpMs: 40_000,
  warnMs: 10_000,
};

/**
 * Reaching Thursday from a phone (features/reach): a chat app the server asks for what was
 * written, so no port is opened and nothing outside can call in.
 * - `pollSeconds`  how long one ask waits for a message before it is asked again. The chat
 *   service holds the request open, so longer is fewer requests, not slower answers.
 * - `retryMs`  the wait after an ask that failed (no network, the service down).
 * - `idleMs`  how long nothing is written before the conversation is closed as a call,
 *   unless work it started is still running. What is written next opens a new one, which
 *   reads this one back under Earlier calls. Shorter and an evening is many calls; longer and
 *   a finished thread raises no desktop notice meanwhile (an open call is taken to be listening).
 * - `messages`  how much of the conversation she is sent with a turn. Every turn sends all of
 *   it again, so this bounds what a long day of writing costs a turn, not what the model can
 *   hold. Only words are counted: what a tool answered and what she thought leave an older
 *   turn before this is looked at.
 * - `trimTo`  what is left once `messages` is passed, cut where the user speaks. Below it on
 *   purpose: a conversation that loses one message a turn opens differently every turn, and
 *   the provider's prompt cache never matches.
 * - `oldChars`  the most an older message keeps. The turn just answered is never cut.
 * - `chars`  how much goes in one chat message; a longer answer goes as several.
 * - `files`  how many of the files her answer names are sent along with it.
 * - `fileBytes`  the largest file sent; the service refuses more.
 * - `pictures`  how many pictures of a page go with it (reach/pictures): its first slides or
 *   boards, or its first screens from the top. With the page itself that is ten files, what
 *   one Discord message carries and one Telegram album holds; the page has the rest.
 * - `drawMs`  how long drawing them may take before the page goes without them. Nine slides
 *   draw in a few seconds; a page that never finishes loading would otherwise hold up
 *   everything sent after it.
 */
export const REACH = {
  pollSeconds: 50,
  retryMs: 5_000,
  idleMs: 10 * 60_000,
  messages: 40,
  trimTo: 30,
  oldChars: 1_000,
  chars: 3_500,
  files: 3,
  fileBytes: 45 * 1024 * 1024,
  pictures: 9,
  drawMs: 60_000,
};

/**
 * A call-back rings on the call screen instead of opening the line (use-call-ring).
 * - `ringMs`  how long it rings before it stops by itself. What rang stays in the room's
 *   inbox, and only work that changes after the ring starts rings again.
 */
export const CALL_BACK = {
  ringMs: 30_000,
};

/**
 * How long the idle hint says why the last call ended (thursday.tsx Hint) before the
 * screen goes back to its usual line. Longer and a reason from hours ago is still the
 * only thing on screen, in place of the way back in; shorter and someone who stepped
 * away as the line dropped never learns why.
 */
export const CALL_ENDED_MS = 12_000;

/**
 * How the page hangs up once the backend calls `end_call` (useThursday): her goodbye is let
 * finish, within bounds.
 * - `quietMs`  silence after her voice that counts as the goodbye being over, and the least
 *   time the tool's own result gets to go out. Shorter clips a goodbye at a pause; longer
 *   leaves dead air before the line drops.
 * - `unsaidMs`  how long to wait for a goodbye that has not started; voice heard this
 *   long before `end_call` counts as the goodbye already said.
 * - `maxMs`  the longest the line stays open after `end_call`, however long she talks.
 */
export const CALL_END = {
  quietMs: 600,
  unsaidMs: 2_000,
  maxMs: 8_000,
};

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
   * split by how long what is in them lives: `artifacts/<bot>` finished results
   * the user opens and `projects` code that outlives any one job are the user's
   * and stay; `scratch/<job>` goes with its job, or once the job has ended
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
  /**
   * The sites the user signed in to (features/signins), one file a site. Under DATA_DIR and
   * outside the workspace, so no bot comes across another's session among its files; named
   * here because `pnpm reset` has to find it without the app.
   */
  signIns: ".sign-ins",
  skills: {
    default: "skills", // ships with the app, read-only
    // The user's own, inside the workspace; where `npx skills add` installs.
    custom: `${WORKSPACE}/.agents/skills`,
    // One bot's own, inside its folder (`bots/<name>/.agents/skills`): listed to that bot
    // alone. The same shape as `custom`, so `npx skills add` run from the bot's folder
    // installs here and what that tool leaves beside it goes when the bot's folder does.
    own: ".agents/skills",
    // Inside a skill, what its scripts draw with — a page's shell, a deck's drawing — and a
    // bot never opens: `load_skill` leaves it out of the files it lists
    runtime: "runtime",
    // A ready-made bot's own skills, shipped with the app beside `default`:
    // `seed-skills/<the bot's name, lowercased>/`, listed to the bot of that name alone and read
    // where they ship, never copied, so an update of the app reaches them
    seeds: "seed-skills",
  },
};

/** Rows per page for every scrolling list. */
export const PAGE_SIZE = 50;

/**
 * Ended jobs, done or stopped, the inbox carries beside everything still running
 * or waiting, read or not, so the room sees each one end (a stop is read by
 * whoever made it); older ones are under History only. The room in the call
 * screen's corner and the Threads badge read that one list. Unread endings, and
 * endings a call has not relayed, remain regardless of this limit. More keeps
 * older endings in reach at the cost of a larger inbox read.
 */
export const INBOX_FINISHED = 5;

/** Jobs returned to the call: prioritize open work, then fill with recent endings. */
export const THREAD_STATUS_LIMIT = 10;

/** History page size in calls, not rows; each call carries every turn. */
export const CALL_HISTORY_PAGE = 10;

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
 * - `autoCloseMs`  how long a file Thursday put up on a call stands before it
 *           closes itself. It is the glance, not the read: long enough to see
 *           what arrived, short enough that a caller who is not looking gets
 *           their screen back without touching anything. The first real input
 *           cancels it for good, so raising this only lengthens the glance.
 *           A file the user opened is never on this clock.
 */
export const WORKSPACE_VIEW = {
  rows: 200,
  textMax: 512 * 1024,
  autoCloseMs: 5_000,
  elementMax: 50 * 1024 * 1024,
};

/**
 * A file's face before it is opened (workspace file-thumb): a page in miniature, the
 * head of a text.
 * - `pageWidth`  the width an html page is laid out at before it is scaled into its
 *   tile. Narrower draws the page's phone layout; wider makes its words smaller.
 * - `textWidth`  the same for markdown and text. Narrower reads larger and shows less.
 * - `textBytes`  how much of a text file is fetched for its face. The tile shows a
 *   screenful; more is downloaded and never seen.
 * - `pages`  how many live pages one message draws. Each is a real page load, scripts
 *   and all; the ones past this show their glyph and open as before.
 * - `imageWidth`  the width a picture's face is optimized to before it is sent. A tile is
 *   at most ~180 CSS px, so this is the retina size; the source is whatever a bot made,
 *   often a few megabytes. One width for every tile, so the same picture in two places is
 *   optimized once. Raising it costs bandwidth and decode time on every screen that lists
 *   files; lowering it shows in the largest tile first.
 * - `cacheSeconds`  how long an optimized face is reused before it is made again. A bot
 *   can overwrite a file under the same name, and the optimizer keys on the url alone, so
 *   this is also how stale a tile can be. Making one again costs ~50ms on the server.
 */
export const FILE_THUMB = {
  pageWidth: 1024,
  textWidth: 512,
  textBytes: 4096,
  pages: 2,
  imageWidth: 384,
  cacheSeconds: 300,
};

/**
 * The Artifacts section (features/artifact), which lists every bot's folder in
 * `artifacts/` and what is loose there — one entry is one artifact.
 * - `rows`  entries the menu returns; the rest load on demand.
 * - `setFiles`  files one opened set draws before the sheet asks for more.
 * What the browser is handed is capped by WORKSPACE_VIEW: the two sections
 * open files with the same reader.
 */
export const ARTIFACT_VIEW = { rows: 200, setFiles: 120 };

/**
 * Files the user hands over from the screen (the write line). They are kept in the
 * workspace under `dir`, so a bot or the call reads one by its path and nothing else
 * stores it; a bot cannot write there.
 * - `maxBytes`    the largest one file taken. `next.config.ts` sets the server action
 *   body limit from the same two numbers, so raise them together.
 * - `perMessage`  how many one message carries; more reads as a folder, which is better
 *   named in words.
 */
export const GIVEN_FILES = {
  dir: "inbox",
  maxBytes: 25 * 1024 * 1024,
  perMessage: 8,
};

/**
 * The corner where finished work lands on the call screen
 * (workspace/components/artifact-view). Nothing about it is kept: a reload
 * clears it, and what the user has not opened still waits in the bot room.
 * - `rows`   finished jobs it holds before the oldest drops off. More turns the
 *   corner into a second inbox, and the room already is one.
 * - `shown`  cards drawn at once. One card stands clear of what she is saying
 *   beside her face, whatever length that runs to; two leave 38px of it and three
 *   cover 236px (measured at 1280x860). The rest of `rows` wait behind it, counted,
 *   and step forward as the one in front is opened or closed.
 * - `words`  characters of the answer a card is sent. It draws two lines of
 *   them; the rest only makes the event heavier.
 */
export const FINISHED_NOTICE = { rows: 5, shown: 1, words: 240 };

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
 * - `participants`  distinct bots allowed in one room. Existing participants remain reusable.
 * - `concurrent`  participant turns allowed to run together in one thread. A bot still runs once at a time.
 * - `turns`  automatic turns across the whole room between user messages or manual resumes.
 * - `queuedMessages`  open exchanges allowed in one room, including questions waiting on the user.
 * - `silenceMs`  how long a model call may send nothing before the run takes the
 *            connection for dead and stops (bot.run silenceWatch). Not counted
 *            while a tool or a compaction does the work; those bound themselves.
 *            A model that thinks before its first word is silent that long, so
 *            this is minutes. A one-shot call (compaction)
 *            sends nothing until it is done and gets it whole.
 * - `overflowShrink`  what a job's compaction threshold is multiplied by when the
 *            model refuses its context as too long, so the resume compacts first.
 * - `retryMs`  wait before the one more try a turn gets when its model call breaks
 *            (a dropped or garbled stream, an overload, a model gone quiet, a context
 *            refused as too long). A second break, a provider's refusal (the key, the
 *            credit, the model id), the content filter and the step limit wait for a
 *            person. Longer rides out a longer outage; the turn holds its place meanwhile.
 * - `compactFiles`  files the app lists under a compaction summary — what the job
 *            has on disk, the newest kept (bot.run filesUnder). Past it the list
 *            says how many older ones there are; all of them stay in the Workspace.
 */
export const BOT_RUN = {
  steps: 100,
  compactAt: 500_000,
  compactHeadroom: 0.8,
  summaryWords: { min: 600, max: 3000, perTokens: 200 },
  // Bound concurrent work and the whole conversation between user interjections.
  participants: 12,
  concurrent: 4,
  turns: 120,
  queuedMessages: 200,
  silenceMs: 5 * 60_000,
  overflowShrink: 0.6,
  retryMs: 10_000,
  compactFiles: 40,
};

/**
 * How much a bot's own memory (`bots/<name>/memory/`, features/bot/bot.memory) holds. Its
 * prompt lists every file by its first line, paid on every step of every job that bot runs,
 * and a job that opens a file reads all of it. A `bash` or `write_file` that leaves more files,
 * or a longer file, is undone and its result names the limit, so the bot deletes, merges or
 * shortens and writes again. Lowering either removes nothing already kept; the bot hears of it
 * on its next write there.
 * - `files`  files the folder keeps, every one of them listed.
 * - `chars`  characters in one file, not counting whitespace at either end. Characters rather
 *            than tokens because a bot can count them itself (`wc -m`).
 */
export const BOT_MEMORY_LIMITS = { files: 20, chars: 10_000 };

/**
 * How many of its other threads a bot's prompt lists (thread.query `listBotWork`): the ones
 * it coordinates and the ones it was called into, each as one line with its own last words
 * there. It is what a new thread knows of the bot's earlier work without anything being kept
 * for it. Paid on every turn that bot runs; more reaches further back at that cost.
 * - `open`    threads still running or waiting, newest first.
 * - `recent`  threads that ended, newest first.
 * - `said`    characters of those last words a line carries. A line cut here carries an id,
 *             and only then is the bot handed the tool that opens one whole: nothing cut,
 *             no tool. Longer lines cost every turn; shorter ones send the bot to the tool.
 * - `files`   paths one line names from those last words.
 * - `reads`   threads that tool opens in one turn, so a model that opens them out of habit
 *             spends this many steps on it and no more.
 * - `asked`, `readChars`  characters of what it was asked there, and of its last words, that
 *             one opening returns.
 */
export const BOT_WORK = {
  open: 5,
  recent: 5,
  said: 80,
  files: 2,
  reads: 2,
  asked: 400,
  readChars: 4_000,
};

/**
 * Routines: jobs that start by themselves (features/routine). Every start is a model run
 * nobody asked for that minute, so what bounds them is here rather than in a prompt.
 * - `tickMs`    how often the clock looks for a routine that is due. A start is late by at
 *               most this; shorter buys nothing a person would notice.
 * - `max`       routines that can exist. Past it, making one is refused with the number.
 * - `minHours`  the shortest `every` interval. Lower starts more runs nobody watches.
 * - `runsShown` a routine's latest runs listed on its sheet; the rest are in Threads.
 */
export const ROUTINE = { tickMs: 30_000, max: 12, minHours: 1, runsShown: 5 };

/**
 * Shipped skills a seed bot claims by name (PATHS.skills.default), because they are the tool
 * of that bot's trade rather than one method among many. Every other
 * skill a bot finds through its own description.
 */
export const ARTIFACT_SKILL = "artifact";
export const PAGE_SKILL = "interactive-page";
/** The Marketer's own, shipped in `seed-skills/marketer/` (PATHS.skills.seeds). */
export const MARKETING_SKILL = "marketing";

/**
 * Shipped skill names that were folded into another, and the one they are in now. A role
 * copied into a bot before the fold still names the old one (bot.seed): `load_skill` opens
 * the new one for it and says so, rather than answering that no such skill exists.
 */
export const SKILLS_FOLDED: Record<string, string> = {
  design: ARTIFACT_SKILL,
  "picture-book": ARTIFACT_SKILL,
};

/**
 * Settings › Skills (features/skills).
 * - `uploadBytes`  the largest `.md`, `.zip` or `.skill` it takes. Raising it lets a skill with
 *                  bigger files in; the file crosses as base64, a third larger, in one server
 *                  action under next.config's bodySizeLimit.
 * - `inlineBytes`  the largest file it shows, and writes back, as text; one past it is listed
 *                  as a file a bot still reads from disk.
 */
export const SKILL_FILES = {
  uploadBytes: 20 * 1024 * 1024,
  inlineBytes: 512 * 1024,
};

/**
 * A deck a bot makes with `make_deck` (ai/tools/deck.tool).
 * - `slides`  the most one deck holds. A change sends the whole deck again, so a longer one
 *   costs every change more to write; past this it is a document, not a talk.
 * - `shotsMs`  how long the pictures of its slides may take before the deck is handed back
 *   without them, unchecked. Thirty slides are drawn in well under a minute.
 */
export const DECK = { slides: 30, shotsMs: 90_000 };

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
 * `bash`). She keeps listening, but the backend cannot answer until the command
 * returns, so this is how long one command can hold her answer back; anything
 * slower is a job for a bot. Raising it lets the call run slower commands itself,
 * and leaves the user waiting that much longer for the result.
 */
export const CALL_EXEC_TIMEOUT_MS = 15_000;

/**
 * A call in writing (thursday/thursday.text): the call's backend alone, answering what is
 * typed to her.
 * - `maxSteps`  how many model steps one answer may take. Each tool she uses is a step,
 *   so fewer cuts an answer short in the middle of looking something up; more lets a
 *   cheap model circle for that long before the user reads anything.
 * - `model`     what the call row carries where a voice call names its Live model, so a
 *   call kept in writing can be told from one that was spoken.
 * - `autoTurns`  how many turns a bot's update may start on its own between the user's
 *   messages (use-text-call). Past it what bots send waits on screen and goes in with the
 *   next thing the user writes: fewer leaves results unanswered in the conversation, more
 *   lets her and a bot trade replies that long with nobody reading.
 */
export const TEXT_CALL = { maxSteps: 12, model: "text", autoTurns: 10 };

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
 * How long what the app kept of its own use stays before it clears it by itself
 * (instrumentation): an ended call with its turns, and a job that finished with
 * its messages. Nothing else grows without an end — every other table is a
 * standing list the user edits — and these two are the ones a daily driver writes
 * most: a ten-minute call is about 150 rows, a thirty-step job about 60 wider ones.
 * - `forMs`  counted from when the call ended or the job did. A job still running
 *            or waiting on the user is never touched however old, and a job's
 *            finished work is not in these rows: it is in `artifacts/`, which
 *            nothing clears. Long enough that she can still be asked about a
 *            season's worth of what was said.
 * - `sweepEveryMs`  how often the app looks, besides once at boot. Far shorter
 *            than `forMs`, so the exact moment never matters.
 */
export const HISTORY_KEEP = {
  forMs: 90 * 24 * 60 * 60 * 1000,
  sweepEveryMs: 6 * 60 * 60 * 1000,
};

/**
 * How much of the previous call the prompt carries verbatim: `rows` turns are
 * fetched, then filled newest-first until `tokens` is spent.
 */
export const RECENT_CALL = { rows: 20, tokens: 600 };

/**
 * How long the event stream may have no browser on it before the app treats
 * the browser as closed (app/api/events presence): the calls its tabs held close, and
 * what finishes from then on goes to a desktop notice or a phone. Work itself runs on.
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
 * in facts. Nothing is deleted on its own: past either of the first two the call's backend is
 * told to say so once in what it returns and settle it with the user (thursday.prompt memory).
 * Facts rather than tokens because it is the number the user sees on their own screen and the
 * number a model is told after every write — a token estimate is nobody's unit and
 * cannot be acted on. Profile and preferences are written out whole in every call's prompt,
 * so `factsPerNote` is also what bounds those two chapters.
 * - `facts`  facts held across every note, above which the listing is too long.
 * - `factsPerNote`  facts in one note, above which that note is named instead.
 * - `descriptionChars`  the longest line a note is listed by, on screen and in a
 *            prompt alike; a longer one is refused. A line is what a note is about,
 *            and past this length it has become a list of what is inside — which
 *            the facts already are.
 */
export const MEMORY_LIMITS = {
  facts: 400,
  factsPerNote: 50,
  descriptionChars: 100,
};

/**
 * One picture handed to a model: a look at an image (features/ai/tools/look.tool), and one
 * an image call works from (features/ai/tools/studio.tool).
 * - `maxBytes`  the largest file handed to a model as a picture. It rides in the request as
 *   base64, a third larger, on every step of the run that looked; providers refuse a request
 *   past a few tens of megabytes, and a screenshot is a few hundred kilobytes. Over this the
 *   tool says so and how to make a smaller copy, rather than sending it.
 */
export const LOOK = { maxBytes: 4 * 1024 * 1024 };

/**
 * One web search (features/ai/tools/search.tool), Exa or a model's own.
 * - `sources`  hits carried back. Each is a page's worth of tokens in the run from then on,
 *            and the first few answer most questions; a bot that needs more searches again.
 * - `excerptChars`  how much of one page rides back with it; a bot that wants
 *            the whole page fetches it.
 * - `timeoutMs`  one deadline for both ways in. Nobody is watching a search, so
 *            a request that never answers would hold the step until the job's
 *            own timeout; a line saying so is worth more than the wait.
 */
export const SEARCH = { sources: 3, excerptChars: 1_200, timeoutMs: 30_000 };

/**
 * A site's icon — beside a page a web search read, beside a connector — (lib/favicon): this server asks the
 * site for it, so neither the browser nor a third party learns which pages came up.
 * - `timeoutMs`  one site's wait; past it the chip draws the site's first letter.
 * - `maxBytes`  larger is not an icon; it is refused and the letter drawn instead.
 * - `kept`  sites remembered for the life of the server, found or not; the oldest go
 *   first. More asks fewer sites twice at the cost of memory.
 * - `pageBytes`  how much of a front page is read for the icon it names, when the site
 *   has no `/favicon.ico`. The head is at the top; more reads pages that bury it.
 */
export const FAVICON = {
  timeoutMs: 4_000,
  maxBytes: 300_000,
  kept: 500,
  pageBytes: 65_536,
};

/**
 * At or under this many dollars left on the gateway key, its row in Settings › Models & keys
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
 * At or past this share of a GPT Subscription window used, its row in Settings › Models & keys turns
 * amber (ai/chatgpt readChatGptUsage): a long job can spend the rest before it finishes and
 * then waits for the window to reset. Lower warns sooner; 100 warns only once it is spent.
 */
export const CHATGPT_USAGE_HIGH = 80;

/**
 * How many of a skill's files `load_skill` lists beside its instructions. The list is
 * what tells a bot which references and scripts are there to open, and it is paid for
 * on every load: each is the full path it is opened by, some twenty tokens. Shallowest
 * first, so what is cut is what
 * sits deep in a bundled engine or a component kit, and the tool says how many were.
 */
export const SKILL_FILES_LISTED = 50;

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
  /** A past job's answer in the transcript; the rest is asked for with `thread`. */
  jobOutcome: 160,
  /** The first line a file in a bot's own memory is listed by (config BOT_MEMORY_LIMITS). */
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
