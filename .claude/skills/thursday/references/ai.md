# Prompts, tools and the bot runtime

`features/ai/` holds everything a model sees; `features/bot/` runs it. Read this before changing a
prompt, a tool description, the bot loop, or how memory is kept.

- **A fact goes where it can still act.** What only the machine knows is read rather than guessed —
  which runtimes and package managers are here — but it is read as the prompt is assembled
  (`workspace.ts` `readMachineTools`, one `command -v` sweep per job, ~5ms) and stated in the
  Environment chapter, because it decides the *first* command and anything attached to a result
  arrives a step too late to. Measured: a bot told what is here still verifies, but narrowly
  (`node -v` instead of `which node bun tsx ts-node pnpm`), and sometimes not at all — one skipped
  step is worth many times the line that skipped it. What a run can only learn by hitting it rides
  on the first `bash` result instead (`ai/tools/workspace.tool` `SHELL_GUIDE`), once per run: a new
  shell per command, no answer to a question and a kill at `EXEC_TIMEOUT_MS`, keys stripped from the
  environment — an empty variable is not an unset one, and nothing in a command's output says which.
  Only the procedure moved out of the prompt; the capability stays (`MACHINE`), because a bot not
  told it may install stops rather than asks. Do not put in either what the model already does:
  `nohup … > file 2>&1 &` was written into the guide and measured to be what it reached for anyway.
- **A job ends in an answer, and the spoken line is hers.** The tool is `answer`, not `report`, and
  the difference is the size of what comes back: a bot told to write something that will be read out
  loud writes for a length rather than for a question, and the padding it adds to reach that length
  is steps, not words — measured, on a one-fact question that had its answer at step 21 of 25 and
  spent the rest collecting a second route and a toll. So the bot answers Thursday at the size of the
  request (`prompts/bot.prompt` `ANSWERING`, the one upper bound a run has), and she composes what is
  said from it (`thursday.prompt` `comingBack`). What lets her cut it short is a fact rather than an
  instruction: the whole answer is already drawn on the user's screen, so its length is not how much
  to say. Both halves are one decision — a bot writing to be heard and a Thursday told to summarise
  it in one sentence is the same line composed twice, which is what the two prompts used to say.
- **Whether a job is over is the runtime's word, never the model's.** `answer` used to take a
  `complete` flag, and a cheap model set it by how the sentence felt: "checking, one moment" came back
  `true` and closed a job mid-work, "still going" came back `false` and parked one for minutes. An
  answer now ends the job, and so does a run that stops on prose without calling the tool — the prose
  was its answer. Only the app calls a run stopped (bot.run `stopped`): the step cap narrowed the last
  step to `answer`, the answer was refused there, or nothing came back. A stopped job waits with the one
  continue option, and why it stopped is in its outcome rather than a label. The cap is set to be
  rarely met (`BOT_RUN.steps`) and stated nowhere a bot reads.
- **Thursday tells an ending on the call it happened during, and no other** (`use-thursday` relay).
  A job that ended before the call is already in her prompt, on the `delegate` line that opened it
  (`thursday.prompt` `recentCalls` reads the job as it stands), so relaying it again at call open said
  it twice — and on every call after, until someone opened it. A question still waiting is relayed on
  each call, because it still needs an answer. Telling is not seeing: the badge clears only when the
  user opens the job.
- **A tool argument that may be null may also be left out** (`.nullish()`, not `.nullable()`).
  Measured: `.nullable()` puts the key in the schema's `required` list, so a model that omits an
  optional argument fails validation outright and spends a step recovering — which cheap models do
  routinely. The exception is an argument where null is an *instruction* rather than an absence:
  `memory_show.path` is `.nullable()` because null means "take it off the screen", and a forgotten
  key would hide a note instead of showing one.
- **The app's own tools are never deferred.** MCP tools sit behind `tool_search` because a server can
  publish hundreds; a runtime holds about ten of its own, and hiding those to save a few hundred
  tokens costs a step to find them and reads as a capability that is not there. What grows with use
  is the listings (memory, skills, connected tools), not the prose — measure before cutting either.
  Past `PROMPT_CROWDED` the Bots and Skills screens say what the set costs, because the lines are
  the user's to add and nothing else in the app would tell them. Stating the cost, never capping.
- **Search is one lookup, or it is the browser.** `web_search` is Exa when its key is set
  (`EXA_API_KEY`, Settings › Config: one POST, the pages back as excerpts), else the run's own
  model's native search one call down — a provider tool cannot be handed to another provider's
  model, result shapes differ per provider, and Google cannot send its search tool alongside
  function tools in one request. There is no third way: a bot on the gateway with no Exa key has
  no search tool at all and goes to the browser. What was there before borrowed whichever
  provider had a key, so every search carried a second model call on a model nobody picked —
  that is where the minute-long searches came from. Both ways in share one deadline
  (`SEARCH.timeoutMs`) and both answer a failure as one line naming the browser, because
  nobody is watching a search and a step spent is a step either way.
- **A prompt says what it costs.** Every assembly logs its own breakdown by chapter, and the tool
  set logs its own (`prompts/prompt-helper` `logPromptSize`, `load-tools` `logToolSize`). What grows
  is the listings, which belong to the user, so nothing in the app would otherwise notice — the
  numbers in the bullet above were a guess until they were measured, and the guess was wrong in both
  directions. Past `PROMPT_BUDGET` the line is a warning naming the chapter carrying it, so a shipped
  install says so as well, where a debug line never prints.
- **Memory is written as it is said, and nothing re-reads it afterwards.** A second pass over
  finished calls was tried and removed: its only trigger was the call ending, which is the moment
  the browser is most likely to go, and the presence rule then killed the run mid-read — so it
  spent a context, stamped nothing and read the same turns again next time. What memory holds is
  what a hand actually wrote while it was there. A listing that has grown says so in the call
  prompt instead (`prompt-helper` `tidying`, config `MEMORY_LIMITS`), and the user
  is the one who drops a line.
- **A tool two runtimes share names no tool in what it returns.** `memory_recall` is the call's and
  a bot's, so what it returns is read by a runtime with a screen and by one without. It used to
  append "put it on screen with `memory_show`" past `MEMORY_LIMITS.factsPerNote` — a tool a bot
  never holds, and one the call itself only held while its listing was over, so the same line could
  name a missing tool on both sides. Now every read and write hands back `factCount`, and past the
  size it adds the ask — which of it is no longer true — and never the mechanism. The write itself
  always goes through: refusing it would lose a fact to a limit that is a recommendation. The same
  reading made `botRememberTool` able to name a note it creates: a bot that could not answer "this
  note has no line yet" left the listing everyone reads described by whichever fact happened to
  land first, forever, because `unnamed` is only reported to whoever created the note. The names
  the user says out loud stay the call's — a bot never hears them.
- **Memory is measured in facts.** Both limits are counts (`MEMORY_LIMITS.facts`, `.factsPerNote`),
  not a token estimate: a count is what the user sees on their own screen and what every write hands
  back, so both ends can act on the same number, while an estimate is nobody's unit. The size decides
  two things together, from the one `prompt-helper` `tidying` check: whether `memory_show` is attached
  to the call (`load-tools`), and whether the call prompt carries its one paragraph — which notes have
  outgrown themselves, which are coldest, and that this comes before anything she would raise herself
  (never before what the user came with). The two read the same check, so the paragraph never names
  the tool when it is not there; a tool result, which cannot know that, names no tool at all.
- **Two clocks in one prompt must be the same clock.** The transcript header was
  `startedAt.toISOString()` — UTC — while the identity chapter's `Now` is local with a named zone
  (`clockNow`). Nine hours apart in Seoul, in the same prompt, with no label saying so: a call from
  last night read as one from this afternoon, and the relative "(15 hours ago)" beside it
  contradicted the stamp it sat next to. Both are `format(…, "yyyy-MM-dd (EEE) HH:mm")` now.
- **A warning names a few of what it caught, never all of it.** Both halves of the tidy line cap
  what they list — the coldest four, the three heaviest — because the thing being warned about is a
  listing that has grown too long. Measured: forty heavy notes made that one line 861 characters,
  216 tokens, a second listing inside the warning about the first. Lowering
  `MEMORY_LIMITS.factsPerNote` is what makes it likely, so the cap is on the line, not on the
  threshold.
- **A note the app names, no model does** (`memory.schema` `isAppNamed`): `profile`, `preferences`
  and `inbox`. Their listing line says what the note is *for*, which does not change with what
  falls into it, so a `description` from any hand is ignored there and the app's own line written
  instead. Without it the inbox is described by the last fact that had nowhere to go, in whichever
  language wrote it — and it was, both ways round: the call's fallback overwrote the line in
  English every time a fact fell in, while a direct write to `inbox` could set it to anything.
- **A fact can open the conversation it was said in, and that is its only door into calls.**
  `memory_fact.call_id` is set by the runtime that wrote it — the call's own id, reaching the tool set
  through the tool-call route — and is null for the screen and for a bot, so it cannot be claimed.
  `memory_conversation` is keyed by the fact id, never the call id: the model already holds fact ids,
  and a UUID on every fact would be twenty tokens of nothing per line. It hands back the whole call,
  `MEMORY_CONVERSATION_PAGE` turns a page — the longest call measured was 84 turns, so one page — and
  a tool turn as its name alone: the arguments are already in memory and the results are not what
  anyone said. Two things keep it from being reached for on every turn. A fact written in the call
  that is asking gets one line back instead of the call, because that conversation is already the
  model's context — enforced in the tool, not asked for in the prompt. And the prompt carries one
  clause for the call and none for a bot: open it only when the line itself cannot answer. What tells
  a model which facts have a conversation at all is `said` on those facts in a recall, the local stamp
  of the call, in the same shape as the Recent conversation headers (`prompt-helper` `callStamp`), so a
  fact from a call already in the prompt reads as that call. No backfill: existing facts stay null.
- **Memory is edited from its own screen in one streamed run.** The Memory section floats a
  one-line input (`memory/components/memory-edit`, `useChat` from `@ai-sdk/react`); a send is one
  POST that streams back (`memory/memory.edit` `streamMemoryEdit`), with memory's two writes
  executing as the model calls them (`load-tools` target `memory-edit`, recorded as the user's
  hand). Nothing about the exchange is kept: the page holds the messages, drops them on the next
  send and a moment after a clean finish. The first step is `toolChoice: "required"` and every
  later one `auto` (`prepareStep`) — required on every step leaves a model no way to end short of
  the cap (20, local to the runner), so a one-line request would write twenty times; the SDK's
  other answer, a `done` tool, was turned down as one more name for the model to learn. A step
  that ends in text is drawn too. An error before the stream starts comes back as plain text with
  a status, because the route boundary's Result JSON would read on the page as a broken stream.
  The prompt lists notes the way the call's does — a line each with its fact count — and
  `memory_recall` opens one for its facts and ids, so the prompt grows with notes, not facts. That
  read is not counted (`createMemoryTools` `countReads: false`): the counts rank notes cold in the
  call prompt, and an edit opening a note to change it is not a recall. `@ai-sdk/react` is pinned to the release built on the installed `ai`: the next one pulls a
  newer `ai` whose tool types the provider packages do not accept (measured: four errors in
  `ai/model.ts`).
- **Memory is one note kept by three hands, and each fact records whose.** The user typing on the
  screen, the call as they talk, a bot that turned something up mid-job —
  `memory_fact.source` (memory.schema `MemorySource`). No model chooses it: the runtime knows
  which it is (`load-tools`), so it cannot be claimed. It is for the person looking at their own
  memory and stays off every model-facing surface: a bare `bot` beside a line says nothing a reader
  can act on — it cannot tell whether that bot was itself — and costs a sentence to explain. Null
  where it was never recorded — unknown, not guessed. The two chapters a bot could confuse now name each
  other: memory is about the user and everyone reads it, `bot_note` is about this machine and only
  that bot does.
- **A bot is switched off in one read.** `listJobBots` is the only place `bot.disabled` is
  filtered, and every roster a model sees is built from it — both prompts, and the list
  `delegate` names on a miss — so off is off everywhere without a second rule to keep.
  `findJobBot` resolves a switched-off bot on purpose: a job already under way resumes through
  it, and stranding a thread the user can still answer is worse than one bot finishing what it
  was already given. What refuses is the *pick*: `delegate`, and `bot.run` for every fresh start
  behind it (`ask_bot`, the screen's hand-over). The fallback worker answers "no bots exist" and
  never "every bot is off" — conjuring one there would undo the choice.
- **A bot writes its own prompt, but never writes it itself.** `bot_note` is one block of
  prose per bot, keyed by name so the default bot has one too, capped at `BOT_NOTES.chars`:
  what working on this machine has taught it, read at the top of its every job and by nobody
  else. On `answer` it says only what it wants *changed* — add, correct or drop,
  in its own words at any length, and nothing to say is the usual answer — and
  `features/bot/bot.notes` rewrites the block from that: the same model the job ran on,
  no system prompt, one user turn holding the block and the request, one tool, forced. Two
  models because they are two jobs; a bot that rewrites the block itself edits it around the
  job it was on and drops what that job was not about, which is measured, not assumed. No
  request, no pass, so a job that taught nothing costs nothing, and a line carries forward by
  nobody mentioning it. Concurrency is one per-bot lane (`lib/queue`): the second pass reads
  what the first wrote. One switch for the whole set (`BOT_NOTES_KEY`, on unless switched
  off) and it is structural — off, the chapter is not drawn and `answer` has no field for it,
  so nothing describes a change nobody will make. Memory is the user and everyone reads it;
  this is how the work goes here and only that bot reads it. The screen shows it under the
  bot's face, where it reads as part of who the bot is rather than one more setting, and can
  only throw it away — a line the user typed would come back rewritten by the next pass.
- **A run records its own ending; nothing else polls for it.** `drive` marks the task `failed` in its
  own `catch`, and that write is durable because writes are serialised — the zombie rows that started
  this were the failure write losing to `SQLITE_BUSY`, not a missing watchdog. The only reconcile is
  at boot (`bot.runner` `sweepTasks`), where every `running` row provably belongs to a dead process;
  it lands them as `waiting` with the one continue option, the shape a step limit already leaves, so
  the thread stays whole and answering resumes it. A run that ends badly also writes one line into
  its own thread (`ThreadWriter.note`, a user row marked `note`): a thread that simply stops shows a
  tool call with no answer, and neither the room nor a resumed run can say why. `note` is separate
  from `compact` on purpose — how a row reads and where a resume starts are two facts, and a break
  marked `compact` would throw the thread away.
- **An event the call seam has no case for is logged, not dropped** (`lib/realtime/realtime.driver`).
  Providers speak this protocol with their own additions, and a missing case is invisible: the event
  goes nowhere and the conversation quietly loses what it carried. A user turn whose transcription
  failed is the example that cost the most — the item never got words, an item with no words is not
  reported at all, and the turn vanished from the transcript that bot briefings and the call prompt
  both draw from. Once per type per session, so a busy stream cannot drown it.
- **The workspace is split by how long what is in it lives.** `artifacts/` is the user's finished
  work and stays — flat and unattributed, one top-level entry per result, which is what the Artifacts
  screen reads. `projects/` is code that outlives the job that started it. `scratch/<label>-<id>/` is
  one job's working material and goes when the job's row does (`workspace.ts` `jobScratch` /
  `removeJobScratch`, from `bot.runner`): per *job* rather than per bot, because several bots work
  inside one job (`ask_bot`) and one bot runs many jobs — and because a job ends, which is the only
  thing that makes its material safe to clear. `bots/<name>/` is one bot's own kit across every job
  it runs; its notes are prose and capped, and this is where the rest goes — a saved sign-in
  (`.auth/<site>.json`) among them, because a session is one bot's across jobs and the workspace root
  is nobody's. The skill and the Insta seed used to name different homes for it and the same login
  was written to both. `.output/`, where tool output past `TOOL_OUTPUT.max` spills, is pruned by age
  when a job ends (`pruneJobFiles`), the way browser snapshots already were.

- **An ended job closes the browser nobody can see, and never the one it showed.** The runner used
  to close the session on every ending but `waiting`, so a job whose answer *was* a window — a map
  with a pin in it, an order at checkout, a sign-in — had it closed the moment it answered. Leaving
  every window to the bot instead was tried on paper and fails the other way: a headless browser the
  bot forgets is invisible, so the user cannot close it either, and a Playwright daemon is detached
  from the app, so it outlives even quitting. The split is the bot's own flag: `--headed` is the bot
  deciding the user should see it, so `closeHiddenBrowser` reads `playwright-cli list --json` and
  closes the session only when it is headless and not attached to the user's Chrome — for a job that
  ended and for a borrowed bot (`ask_bot`) that answered. A headed window is the user's to close.
  Anything unreadable leaves the browser alone. A waiting, paused or abandoned job keeps both: its
  row is on the screen and answering resumes into the page it left off at. `closeJobShell` closes
  whatever is showing, only for a job the user cancelled or deleted — its row is gone.

- **A run compacts against its own model's window.** `compactBudget` (ai/model) answers what the
  bot's owner set (`bot.compactAt`, empty is the usual answer), else `BOT_RUN.compactHeadroom` of the
  window when it can be known — the gateway's catalog carries one per model, and a provider used
  directly reads the one stamped on its shelf (`model.schema` `SuggestModel.context`, taken from the
  gateway's row for the same model) — and `BOT_RUN.compactAt` when it cannot. The fraction is not
  tidiness: the summarising call sends the whole context plus its instructions and must get a summary
  back, so it needs room above the threshold that triggered it. The fallback, 500k, assumes the window a current
  model carries: a smaller model missing from both the catalog and the shelf can reach its limit first. Nothing catches an overflow
  today: the ai sdk has no context-length error class, so a provider's refusal arrives as a plain
  `APICallError` and kills the run.
  The Bots screen fills the number in from the same two helpers (`model.schema` contextWindowOf,
  compactAtFor), in thousands of tokens, and fills it in again whenever the model is changed there —
  a number saved once and never refilled outlives the model it was worked out for.
- **A resume continues the stored conversation, as stored.** `resumeThread` (bot.run) hands a
  resumed run the rows exactly as they were written — each tool call with its result, a question with
  the answer that came back as that call's result — so the run carries on the conversation it was
  having, and a provider's prefix cache still matches from its first call. It used to be folded into
  prose (calls as lines, results dropped, same-role turns merged): that lost the results, broke the
  cache at every resume, and made the same-role problem it then merged away — stored rows alternate
  on their own, a step being an assistant message and its tool results. The one repair left is real:
  a call whose result never arrived because the run was stopped between the two — a closed browser
  pauses every run, a restart abandons them, and an `ask_bot` call waits minutes on the borrowed run —
  gets a result saying so, because a call with no result is refused outright (the ai sdk has
  `MissingToolResultsError` for it). Talking to a running job does not do this: it is queued and read
  before the next step. A thread too big for the model is `compact`'s job.
- **Every seat opens on the same two-part message.** The first message a bot reads is who is who on
  the job, then the chain: the job as Thursday handed it, the call it came from verbatim, and one pair
  of sections per hand-off since — what the handing bot has done and why, then the part
  (`bot.prompt` buildTaskOpening, buildHandoff). The chain's headings name people and never say
  "you", so a borrowed bot's chain is its borrower's copied as it is with two sections added; who is
  who is the one part written per reader. The holder's opening is stored (seq 0); a borrowed bot's is
  built by `ask_bot` and never stored. Before this a borrowed bot got two strings its borrower wrote
  by hand, and the call reached it only if that bot copied it over.
- **One worker, one whole thread; only what is written crosses.** A bot sees everything it did on its
  own task — tool results included, across every continue and every question it stopped to ask — and
  `compact` is the only thing that ever shortens it. What crosses to somebody else is what was
  written: `answer` to Thursday; the chain and the part down through `ask_bot`, the borrowed bot's
  answer back up; `ask_back`'s question and the one-shot reply to it (`answerBack`, no tools, from the
  asking bot's own context). A borrowed run is whole while it lasts — `ask_bot` and `ask_back` both
  have an `execute`, so the reply lands as a tool result and neither side restarts. `BOT_RUN.depth`
  caps how far it goes (2: the holder, one it borrows, one more), and no seat may borrow itself or a
  bot above it, which is blocked waiting on it. That is the whole model, and it is the office one:
  everyone remembers their own work and knows only what they were handed.
- **A compaction keeps the opening.** The summary replaces what came after the first message, never
  the first message — in the run (`prepareStep` keeps `messages[0]`) and on a resume (`listThread`
  reads seq 0, then the last compact row on). The job and the call are read verbatim for the life of
  the job, so the summary is told not to restate them, only where the job stands against them.
