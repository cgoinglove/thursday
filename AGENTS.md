# thursday

A local-first voice agent. GPT-Live 1 ("Thursday") holds the call; a separate Responses backend
(GPT-5.6 Luna by default) runs the call's tools.
The call only touches what can be answered in a glance (memory, one shell command). Anything that takes time — MCP, skills,
a browser, minute-long jobs — is delegated to text-model bots that run in the background with a
shell, a browser and skills; a skill is the one thing that can be handed back to the call
(Settings › Thursday, off by default). Jobs outlive the call: they run on the server, and the
screen is a projection of server state.

**This is a public open-source repository** (MIT, `github.com/cgoinglove/thursday`, published to
npm as `thursday-agent`). Everything committed here is read by strangers and shipped to their
machines. Two things follow, and they are not style preferences:

- **Write for a reader who has never met this code.** English, present tense. `README.ko.md` is
  the one translated file; everywhere else in the tree is English — comments, prompts, strings,
  identifiers, commit messages. Not even as an example inside a comment. No personal names,
  machine paths, keys, or half-finished thoughts in a comment.
- **Anything private is named `*.local.*`** — a scratch note, a to-do list, a plan, a local
  override. `.gitignore` covers that shape, so a file named this way can never be committed by
  accident: how you like to work with an agent — when to ask, how to commit — goes in a
  `*.local.md` file next to this one, loaded by whichever agent tool reads it. This file holds
  only what the code requires. Never `git add -f` one, and never rename one into the tree to
  "keep it for later"; if it is worth keeping, it is worth writing properly.

# Layout

```
features/<name>/          One domain: its data and its screens. A new feature copies this shape.
  <name>.schema.ts        zod is the source of types (z.infer). No server-only imports (used on both sides).
  <name>.query.ts         DB access. drizzle is used here only; screens, actions and tools all call this.
                          Writes emit appEvents here, so every caller notifies the same way.
  <name>.action.ts        "use server" + serverAction. Writes.
  <name>.*.ts             run / manager / store files when the domain needs them.
                          A second query file (`thread.query.ts`) when one table is its own subject.
  components/             Screens for this domain only, including its settings panel.
features/ai/              Everything the model sees. Composes domain query/schema into prompts and tools.
  tools/<d>.tool.ts       The tools one domain answers (memory, bot, workspace, mcp, …): name, description,
                          args, execute. Execute calls the domain query.
  tools/tool-name.ts      Every name the model sees. Tools and prompts both import from here.
  prompts/live.prompt.ts         What the Live voice hears: who Thursday is; under `## Always` the ending
                                 rule, the guide's backchannel and interruption policies and a short
                                 delegation policy (everything but conversation goes to the backend,
                                 what they say about themselves included); what she knows about the user.
                                 No capabilities, procedures, earlier calls, or tool names but `end_call`.
  prompts/thursday.prompt.ts     What the call's Responses backend hears: who Thursday is, memory with ids,
                                 roster and threads, the machine, what to return (on a call in writing,
                                 an answer to read instead), earlier calls with their jobs.
  prompts/bot.prompt.ts          Everything a bot hears. Shares no text with the call prompt.
  prompts/memory-edit.prompt.ts  Everything an edit typed on the Memory screen hears.
  prompts/call-standing.ts       The jobs open as a call starts, put into the conversation once rather
                                 than into a prompt: what is true only at that moment, in facts.
  prompts/call-last.ts           The call before this one — when, how long, its last words — put in the
                                 same way but ahead of the greeting: the voice's prompt holds no earlier
                                 calls, and this is what lets her open as someone who remembers.
  prompts/prompt-helper.ts       Row-to-line formatters, a few thresholds, and the identity both call
                                 prompts open with.
  load-tools.ts           Which runtime holds which tools (ToolRun: the call, a bot, a memory edit).
  model.ts / model.schema.ts   Which model runs, and how it is built.
  components/             The model's own controls: model picker and browser, provider icons.
app/                      Routing shell only. api/<d>/route.ts is one serverRoute line.
  api/query-key.ts        Every endpoint the client reads. Lives next to the routes so they move together.
  api/events/             The server→browser event union, the SSE route and `presence`.
components/ui/            Domain-agnostic UI (shadcn), plus markdown, notify and toast.
hooks/                    Domain-agnostic React hooks.
lib/                      Domain-agnostic only: protocol/ (Result, actions, routes, SWR, paging, event bus,
                          presence), live/ (the call seam: Live session, WebRTC, audio tap), sandbox.ts
                          (interface + creator),
                          public-error, logger, date-like, queue, tokens, limits, utils.
database/db.ts            The one client, and the lane every request goes through (SQLite has one writer).
database/tables.ts        All drizzle tables (relations and migrations look at one place).
database/migrations/      Generated by `pnpm db:generate`, applied at boot (`migrate.ts`).
config.ts                 App knobs: name, the two roots, paths, page sizes, limits. Not secrets (features/config).
bin/                      What ships and runs outside Next: the `thursday` CLI, where the app's own
                          CLIs are, the port both starters pick, and what both do when boot cannot migrate the
                          database (ask to remove it, start again). Plain .mjs — it runs before anything is built.
scripts/dev.mts           `pnpm dev`: `next dev` on 127.0.0.1, on a port nothing holds on any address, handed over as `PORT`.
scripts/reset.mts         Wipes local data (calls, jobs, memory) and optionally the build. `pnpm reset`.
scripts/pack.mts          Builds `dist/`, the tree npm publishes. `pnpm release`.
scripts/intro-voice.mts   Records her first-run lines as clips under `public/voices/intro` (features/intro/intro-voice).
                          Run by hand with an OpenAI key after her spoken lines change; the clips are committed.
guide/                    How the app works for the person using it, written for Thursday to read when an
                          answer depends on it: `index.md` says which file answers what. Screens and
                          settings as the user sees them, never code. `features/ai/guide.ts` is all the
                          code knows about it: boot copies it into the workspace and the call's backend
                          prompt carries one line. Nothing else names it, so it comes out whole.
skills/                   Skills shipped with the app (read-only). User skills live in the workspace.
                          interactive-page/scripts/archify is a trimmed copy of archify (MIT; its README says
                          what was cut). Lint skips it; update it by copying upstream, not by editing it here.
                          interactive-page/kit is the one React kit every page builds on, versions pinned by its
                          package-lock.json; scripts/page.mjs installs it into the workspace once and again
                          when it changes. Typecheck and lint skip it and page/, the new-page template.
seed-skills/<seed>/       A seed bot's own skills (read-only), copied into `bots/<name>/.agents/skills` when
                          it is made. A bot's own skills are listed to it alone, so a kit costs no other bot
                          a line; the folder has the workspace's own `.agents/skills` shape, so a bot that
                          runs `npx skills add` from its folder installs for itself (skills/find-skills).
                          marketer/ is a trimmed copy of marketingskills (MIT; its README says what was cut).
```

Domains today: `thursday` (the call), `bot` (bots and the jobs they run), `routine` (jobs that start
by themselves), `memory`, `workspace` (the
files bots work in) and `artifact` (the finished ones), `skills`, `connectors` (MCP servers), `config`
(keys and models), `signins` (the sites the user signed in to, kept for bots to borrow), `reach`
(writing to her from a phone), `intro` (first run), and `settings` (the settings shell only).

Two roots (`config.ts` `APP_DIR` / `DATA_DIR`): the app's files (build, migrations, bundled skills) and
the user's files (DB, workspace, installed skills). Both default to `process.cwd()` and can be moved
with `THURSDAY_APP_DIR` / `THURSDAY_HOME`. Nothing else reads `cwd`; every path goes through `config.ts`.
`npx thursday-agent` is the same two roots pointed elsewhere: the package for one, `~/.thursday` for
the other (`bin/thursday.mjs`). It is why the app is publishable at all — nothing writes beside itself.

# Conventions

- **Domains hold data, `features/ai` holds the model.** A domain folder has schema, query, action and
  components and knows nothing about prompts or tools. Prompts and `load-tools` are imported only by
  what runs a model: `bot.run` / `bot.runner`, `thursday.action` and the tool-call route,
  `thursday.text`, `memory.edit`. Anything may import the model's vocabulary — `model.schema` (the model a row
  names), `tools/tool-name` (a screen drawing a tool line), `ai/components` (the model picker).
- **Tool names come from one file.** `features/ai/tools/tool-name.ts` is the source. Tools and prompts
  import it, and so does code that reads stored tool calls back (`thread.query`, the call screen's
  `tool-line`); nobody types a tool name as a string.
- **Prompts are split by runtime, not by chapter.** Each prompt file loads its own data and exports
  one function. Shared helpers only format rows; they never decide what to say. Tool descriptions say
  *what* a tool is; prompts say *when* to use it. Prompts are assembled per session, never cached.
- **The call is one Thursday on two models.** The Live voice and its Responses backend open with the
  same identity and the same rule for ending the call (`thursdayIdentity`, `callEnding`, the only
  sentences a helper holds) and read the same memory; neither
  is told it is part of something else. The voice holds conversation and memory only. Right under
  its identity, `## Always` groups the ending rule (the only line stamped `IMPORTANT`), the guide's
  starter backchannel and interruption policies (the backchannel line asking for listening sounds
  through a long turn), and under the guide's `Delegation policy` label three lines — hand everything
  but greetings, small talk and a brief clarification to the backend, hand over whatever they say
  about themselves as they say it, and answer from what the backend returns. What the backend can
  do, how work is handed over, tidying memory and earlier calls are the backend's; it merges a fact
  that repeats or changes one already kept, and it asks the user whether work carries an earlier
  thread on or starts a new one only when it could be either. A relay carries facts — who, which thread —
  never instructions, since the backend reads it too.
- **Tools run on the server.** A call's tool invocation is forwarded by the page to the server, so
  tools call domain queries directly. The one exception is anything that touches the call itself
  (hang up, a word on her face — offered only while the face is the ascii orb).
- **Voice is GPT-Live, not Realtime.** The server exchanges the browser's SDP through
  `/v1/live/sessions`; the API key, both prompts and the tool manifest stay on the server. Live
  speech and Responses work have independent lifecycles. Collect function calls from nested
  `response.output_item.done`, return all outputs, then explicitly continue the backend. The mic
  stays open for the whole call; nothing the page does closes it.
  Live never speaks unprompted: every call opens with an instruction to speak first, and open
  work (unseen endings and stops, unanswered questions) goes in when neither side has been
  transcribed for `CALL_RELAY.quietMs` (on a call the page placed for it, once she has said so),
  each item once a call and, once she has voiced it, not on a
  later call while the page is open (a job that asks or ends again is a new item). Updates go in by
  kind — trusted behaviour as
  `session.instructions.append`, bot output as `commentary`, never the reverse — nothing goes in
  while the backend holds the turn, a bot's message goes in cut to what can be said aloud
  (`CALL_RELAY.chars`), and a relay row is accepted only once she has voiced it: Live's
  acknowledgement says the text arrived, not that anyone heard it. Transcript fragments have timestamps, not final
  turns: caption groups remain revisable and are saved with their fragments. Close with
  `session.close` and wait for `session.closed` before releasing transport resources, with a
  bounded timeout. The full contract is `docs/live-calls.md`. One experiment sits behind a
  constant that is off (`CALL_NUDGE`): the page starting a backend turn the voice did not hand
  over, with the same `response.create` that continues delegated work.
- **Long-running work is the server's, not the request's.** A job's run is a promise the server holds
  (`bot.runner` `launch`), never `after()`: messages and returning browsers also start runs
  outside a request. Everything that happens is written as rows, so what the screen draws and
  what the model re-reads are the same rows.
- **One participant per bot per thread.** A bot resumes its own stored transcript across requests,
  including requests from different callers. `parent` names the current exchange, not the bot's
  identity. Browser sessions use the thread and canonical bot name, and the workspace is marked
  as the browser CLI's own (`.playwright`), so what those sessions keep on disk is this app's
  alone: a cancel closes the windows, a removed or aged-out thread takes its profiles with it.
  Requests to the same bot run sequentially. Messages are asynchronous: a waiting A can handle a question from B in its own
  context, but a bot waiting on the user's answer runs nothing until it arrives; its inbox holds. Only exchanged messages cross participant contexts. `room.query` owns durable inboxes,
  continuation claims and return routes; `bot.runner` owns live promises.
- **A picture reaches a model through one tool.** `look_at` (`tools/look.tool`) answers with the
  image itself: `execute` returns a small record — the path, never the bytes — which is what
  is stored and drawn, and `toModelOutput` turns it into the picture for the run that asked.
  So a row stays a line, and a resumed thread reads that a picture was looked at rather than
  carrying it again. A bot holds it only when its provider carries an image inside a tool
  result (`model.ts` `seesToolImages`); a call in writing holds it too, a spoken one cannot —
  its backend is answered through the page, in text. Past `LOOK.maxBytes` it says how to make
  a smaller copy instead of sending one.
- **A sign-in is the app's to keep and the user's to lend.** A bot borrows one with
  `sign_in_use` and hands over the one the user just made with `sign_in_keep`
  (`tools/signin.tool`); the session lives under `DATA_DIR/sign-ins`, one file a site, outside
  the workspace, and crosses it only as a file that exists for one browser-CLI command. That is
  a place, not a lock — a bot's shell is not confined — and what it buys is that no bot comes
  across another's session among its files. Which bots may borrow is settled on screen only
  (Settings › Sign-ins, or the button a waiting bot's question carries,
  `signin-ask`): a refused borrow is noted as `asking`, and nothing a tool is told lets a bot
  in. Boot takes in what bots used to keep under `bots/<name>/.auth`.
- **A phone reaches her through a chat the server asks, never a port.** `reach` long-polls the
  user's own Telegram bot (`telegram.ts` is all that knows the service) and answers with
  `thursday.text` `answerInWriting`: the run a page's call in writing streams, answered whole,
  with the conversation held by the server instead of a page and kept as the same call row. One
  person may write, and only the computer's screen lets them in (`reach-ask`): whoever writes to
  her can start work here. Open work goes to the phone once the computer has had
  `REACH.notifyAfterMs` to tell it — as a turn of that conversation that is not the user's, its
  relay rows accepted once she has answered, a question's options as buttons that answer the bot
  directly — and progress never does. Her settings live in the browser, so a phone runs on the
  defaults. `scripts/reach.test.mts` runs it against a stubbed service.
- **No browser, nothing runs — unless the user said otherwise.** `presence` (app/api/events) says
  whether a browser is on the stream; when the last one has been gone a while, jobs stop and wait
  and open calls close. When one comes back, only jobs paused for browser absence pick themselves
  back up. One switch changes it (`KEEP_WORKING_KEY`, Settings › Bots, off by default): work then
  runs on with nothing open and only the server stopping parks it, while the open calls still
  close with their tab. Both readers — boot's `onGone` and the room pump — ask the same key. A model call that breaks
  is tried once more (`BOT_RUN.retryMs`); a second break, a provider's refusal, a server restart,
  a resource limit or a user stop waits for a person. Wired once at boot (`instrumentation`),
  not in each domain.
- **A routine only opens threads.** `routine.clock` looks for what is due and calls `startThread`;
  everything after that — questions, stops, the relay into a call — is the thread's, and nothing in
  the room engine knows a routine exists. A run carries `thread.routine_id`, and how a routine is
  doing is read off its latest run, never stored. A due routine is held while no browser is there
  (the same key the pump asks) or its bot is off, and skipped while its last run is still open;
  its next time moves on before the run opens, so two looks start one thread. Only the call holds
  the `routine` tool: what starts by itself is the user's to set up, never a bot's.
- **A call tool does one thing and every argument is required.** The backend model is a cheap one: a
  tool with an action and optional fields is where it put text in the wrong field or sent a
  follow-up as new work. So the call's hands on threads are a family (`thread_start`, `thread_tell`,
  `thread_answer`, `thread_status`, `thread_cancel`, `thread_show`, `thread_seen`), what the server
  can find it finds (which question a bot's answer belongs to), and what a tool returns names the
  next step. To a model it is a *thread* everywhere; to the user it is a label and a bot.
- **What cannot be won by instruction is enforced by structure**: tool sets, per-turn and per-room
  limits, output truncation, shell env. Do not add prompt sentences for things the code can enforce.
- **A turn ending is not a thread ending.** Bots finish with ordinary text or silence. The coordinator
  reports once its downstream work settles; idle rooms remain resumable. Store local calls before
  their effects and results before the next model step. Repair missing results only in the model
  projection, with their outcome explicitly unknown. Never replay arbitrary tools automatically.
- **Vocabulary belongs to whoever produces it.** Band counts come from the tap that fills them,
  provider lists from where the drivers live. No re-export doors. A domain's glyph is vocabulary too:
  it lives in that domain as `components/<name>-mark.tsx` (`bot-mark`, `mcp-mark`), and the settings
  nav and the call screen's tool line both import that one. A second icon table is how they end up
  disagreeing. So is a nav badge: `components/<name>-badge.tsx` reads that domain's own key and draws
  `NavBadge`. It loads with the app, so it never lives in the lazily-loaded setting screen.
- **A number that tunes behaviour is in `config.ts`; a number that *is* the drawing stays where it
  is drawn.** A cap, a deadline, a page size, a step limit, how long something is kept — named in
  `config.ts` with a paragraph saying what moving it does, even when one file reads it. An easing
  time, a radius, a sample rate, a wire timeout the other end also knows: local. The test is who
  the number answers to — the person tuning the app, or the thing being drawn.
- **A tool two runtimes share names no tool in what it returns.** `memory_recall` answers the call
  and a bot. Past `MEMORY_LIMITS.factsPerNote` it says the note has outgrown its size and to ask the
  user what to drop — the ask, which both can act on, never the mechanism: how to settle it with the
  user is the call prompt's to say.
- **Don't split files by size; split by subject.** A long file that does one thing stays one
  file. A file that draws several subjects is several files, however short each one would be.
- **An interface with one implementation is two files, not an interface.** Don't add ports.
- **A feature that may come out again lives in one file.** Its names, paths, boot step and prompt
  text sit together, and the app reaches it from as few lines as it takes (`features/ai/guide.ts`
  is the shape: two callers and a build list). No entry in `config.ts`, no helper in a shared file,
  no import kept for it elsewhere: what is spread across files is what gets left behind.

# Data flow

**Read** — RSC first. Server components call `<name>.query.ts` directly. Client reads go through
`app/api/<d>/route.ts` (`serverRoute(() => findAll())`) and `useServerRoute`:

```ts
const { data: notes } = useServerRoute<MemoryNote[]>(queryKey.memory);
const { data: note } = useServerRoute<MemoryNote>(path ? queryKey.notePath(path) : null); // null pauses
```

Beyond the key it is plain SWR. Responses are typed, not validated at runtime. Read failures toast
from the hook. SWR is for revalidation and dedup, not caching. A list that grows reads through
`useServerPages` instead: the caller's key function addresses a page, and the next one is asked for
when the end of the list comes into view.

**queryKey** — never write a URL in a screen. All keys live in `app/api/query-key.ts`:

```ts
export const queryKey = {
  memory: "/api/memory",
  notePath: (path: string) => ({ url: "/api/memory", query: { path } }),
  mcpServer: (name: string | null) => ({ url: "/api/mcp", pathVariable: [name] }),
} as const;
```

The key is the SWR cache key. `revalidate` matches by URL prefix, so invalidating `queryKey.memory`
also refreshes `queryKey.notePath(path)` and any loaded pages under it. A null path variable pauses
the read the same way a null key does. Invalidation is done by the writer's `onOk`, not by the
action hook:

```ts
const [create] = useServerAction(createNoteAction, {
  onOk: () => {
    revalidate(queryKey.memory);
    onDone();
  },
});
```

**Write** — no routes. Only server actions wrapped in `serverAction`. Routes exist for three cases:
external callers hitting a URL (oauth callback), work that must run in parallel (tool calls during a
call — actions are serial per client), and a response that streams (the SSE route, a memory
edit drawn as the model makes it, a turn of a call in writing).

```ts
export const createNoteAction = serverAction(async (path: unknown, description: unknown) => {
  const parsedPath = PathSchema.parse(path); // validate inside; ZodError messages reach the UI
  const note = await createNote(parsedPath, z.string().min(1).parse(description));
  if (!note) publicError("Note already exists");
  return { id: note.id }; // plain return → Result wrapping
});
```

Actions run sequentially per client. Parallelism happens inside one action.

**Errors** — throw `publicError("message")` anywhere for user-facing failures. The boundary
(`serverAction` / `serverRoute`) forwards that message and masks everything else (logged). In screens,
`useServerAction` handles the toast, pending state and success toast. Tool failures returned to a model
are not masked: return one line the model can read and recover from.

**What an outside API answered is never masked.** A provider's refusal is the user's to act on — the
key, the credit, the model id — and only the provider can say which, so the seam that made the call
raises it public rather than letting the boundary swallow it: `createLiveCall` (lib/live) for
the call's connection, `modelErrorToString` (features/ai/model) for anything the ai sdk wrapped, which also
carries out the body when the sdk's message is the status word alone. The call's own key is
asked about as it is saved (`keyRefusal`): one the provider turns away is not kept and its
words are shown — under the field in amber on the first run and the call screen, where
nothing is broken and the key waits on the user — while no answer at all keeps the key
unasked. The one exception is a
reasoning setting the backend model refuses before a call (`acceptedReasoning`): the call runs
without it, because the user asked for the call, not for that setting.

**Server → browser** — no polling. When a fact happens on the server (a row was written, a browser
opened, something to say), `appEvents.emit` at that spot; the browser listens on one SSE stream. Two
kinds of events: a **signal** when a GET exists (the receiver `revalidate`s that key) and **data** when
none does. New event = one union line + one emit + one handler (+ one `SIGNALS` entry for signals; the
compiler enforces it). Emit where the fact happens (the query's write, the watcher), not in each caller.
A 30-second poll remains as a safety net. No WebSockets.

# UI

- Domain-agnostic components are shadcn (`components/ui/`). Check there before writing a new one.
- Markdown renders through `components/ui/markdown.tsx` (wraps streamdown).
- Confirmations and prompts: `notify.confirm` / `notify.prompt`. Destructive actions confirm first.
- Notifications: `toast.add`, only for things that happen off-screen. Skip it when the result is
  visible.
- Waiting is always a loader: buttons swap their icon for a Loader, lists use `Skeleton`. Never dots,
  and never a new element that shifts the row when it finishes.
- Words for something still running shine (`ShinyText`), and pulse instead on the call screen
  (`motion="pulse"`, the user's pick) — except what the backend is thinking about, which shines
  there too (also the user's pick). It takes its colours from the theme —
  `tone="waiting"` for amber, never a colour — and truncates in its own box, not a parent's.
- Two status colors only: amber (waits on the user — a question, a stopped job, an answer not yet
  opened; `WAITING_INK` in `lib/utils`) and red (failed — `text-destructive`). Success, connected and
  enabled have no color of their own: an unopened answer is amber because it waits on the user, not
  because it worked. The settings nav reports the same two and nothing else (`NavBadge`). A
  screen that already means "this waits on you" — the ringing call, the missed list — says so
  without the amber.
- One brand color, blue (`brand` in `app/globals.css`), and only as a point on black and white:
  the one thing a screen asks for (`Button variant="brand"`, round), a switch that is on, and
  Thursday herself (her caption dot). Never a surface, never a status — a green beside it would
  read as a second brand.
- Errors are never swallowed. Inline or toast, they reach the user.
- Thread questions remain visible while other bots work. Unread endings stay in the inbox until
  the user opens them — its card in the left corner and Thursday's `thread_show` count, closing the
  card does not — or Thursday has told them and marked
  them seen (`thread_seen`); a relay acknowledgement alone never counts as reading. Use neutral surfaces for these
  notices and explicit labels for questions and new results.
- Words stepped in with wait where the composer sits, registered, until the bot's next step reads
  them: a loader and a shining line, never amber, since they wait on the bot and not on the user,
  and they can be taken back until then. Outside the thread only the pill says so, as a shining
  line held by that bot's face. Read, they join the conversation marked `stepped in` — derived (a
  user line straight after that bot's own tool step), never stored.
- Ask the user with an explicit question message; ordinary Thursday messages never block a thread,
  and a question pauses only the bot that asked it. Show one question at a time with optional choices and free text, on a borderless sheet where the
  composer sits; it joins the thread as a record once answered. Its ID selects the recipient and
  its own draft; sending one answer never clears another question's text.
- A thread reads as a conversation from the open tab's bot: that bot holds the left on no surface,
  and everyone else answers from the right — the user's side in the one dark bubble, other bots on
  `secondary`. The dark bubble's contents take the opposite theme through `.inverse`
  (`app/globals.css`), tokens and `dark:` alike. A message to a bot other than the tab's names it
  with a mention at its head.
- Every message draws as words — the user's, questions, answers and reports between participants,
  a bot's reply, the ending — never as the tool call that sent it. The open tab's bot's own work
  draws in full: its words as words, and each run of tool calls folded to a strip of tiles — a
  picture it took, the site it opened, else a glyph for what it did — with only the running step as
  a row. The run's head unfolds it into rows, where a step shows what it touched (the site, the
  file, the pages a search read), never the tool's name. Another bot's work between the messages it sends or receives (steps, stops, the
  words beside a call) folds into one row before its next message, and the row opens in place. A
  thread opens on its own bot's tab, which holds
  every participant; another bot's tab holds only its own lines and the messages that reached it,
  and the composer follows the open tab. Thursday is never invited and never drawn as a bot.
- The files a message names are drawn under its words, whatever the message: what has a face of
  its own as a tile that opens in the viewer where the reader already is — an image, an html page in
  miniature (the live page, sandboxed, the first `FILE_THUMB.pages` of a message), the head of a
  text — everything else as a row with its kind and size, a path with no file struck through. One
  piece draws a file's face everywhere (`file-thumb`): under a message, in the corner, on the
  shelf in Settings › Files. Nothing a job finished opens by itself — it lands in
  the screen's left corner as a card, the same card with files or without: the bot, the label, how
  the answer opens, the files under the words. The corner keeps nothing and is cleared by a reload.
- Thursday is small in one way: `thursday-mark` draws the call's orb in miniature — glyphs keep one
  size, so a bigger box holds more of them, and nothing fades — and every screen draws her through
  it, so a new icon is a change to that file. Only the browser tab keeps the bot-style mark
  (`THURSDAY_SEED`).
- A bot draws with the face picked on its page wherever it appears; nothing varies its mark by
  thread or place, only its state: the amber notify dot while it waits on the user, crossed-out
  eyes on a thread the user stopped (`cancelled`). A job never ends as a failure: a model that
  breaks pauses it as waiting.
- The pill's bubble shows one thing that just happened, over the face of whoever spoke: that face
  with the bots it reached tucked behind it, then the words — no glyph between faces. Questions
  and stops take amber. Clicking the pill opens the room's list, never a thread; the "+" at its
  left end asks for the write line instead. While that line is up the card does not grow —
  the line stands there — and the pill's own words carry the count.
  The open list keeps the pill's row at its foot, faces without step words, and a moment shows
  there instead of in a bubble; only an open thread hides it.

- The first run is drawn as the call screen, over it (`intro`): her face where it will be, her
  words down its left as captions are, and on its right the caller's turn — a key, the
  microphone, the bots, what they think with. It opens on the app's one loop played silently in
  place and ends on a button that places the first call (`call-signal`, which also holds the
  call's wake word and hotkey off while the intro is up). No step blocks or raises a red error:
  each can be passed and done later where it lives. It shows until a call has been placed.
  Her lines there are also heard, as clips recorded ahead (`intro-voice`, the one file that
  holds what she says aloud, where a clip lives and the hook that plays it): no key is
  needed to hear them, the first starts inside the first click, and her face moves to them
  through the same clip tap a voice sample uses. What she says aloud is its own text — she
  opens by saying it is a recording — so a caption can be rewritten without recording
  anything. A clip is named by a hash of its words: a spoken line that changed is silent
  until `scripts/intro-voice.mts` records it again, and a missing clip is never an error.
- What is typed or handed over rather than said goes through one write line at the foot of the
  call screen (`write-line`): absent until asked for (the pill's "+", `/`, a file dragged onto the
  window), it holds who it is for, the words and the files. Files are kept in the workspace
  under `GIVEN_FILES.dir` the moment they arrive and travel as paths in the words — which is
  also how the room draws them under the message. A thread's reply takes files the same way
  (`given-files` is the one hook and the one row of chips), and a drop that lands on the room
  is the open thread's rather than the line's. An open thread is wide enough to cover her
  face, so the call and the line step aside for it (`roomOpen`); the room's list is a short
  card in the corner and moves nothing.
- The line opens on Thursday, and what is sent to her is a call in writing (`thursday.text`,
  `use-text-call`): the call's backend alone — its prompt but for the ending rule and the last
  chapter, its memory, its tools less the page's own (`end_call`, `emote`: there is no line to
  drop), no Live session — drawn by the same call screen and kept as a call
  row (`TEXT_CALL.model` where a spoken one names Live), so Earlier calls and the call log carry
  it with no table of their own. The page holds the conversation and sends it whole each turn;
  the server saves every turn as it happens. It runs on the GPT Subscription when one is signed
  in, else the OpenAI key (`textCallRunsOn`, one rule for the server and the screen) — a rule
  about what is set, never a second try after a refusal — and the line says which before
  anything is sent. Open work reaches it as it reaches a spoken call — the same list
  (`open-work`), between turns once nothing has been written for `CALL_RELAY.quietMs`, as a
  turn of its own that is neither drawn nor kept as the user's words, its relay rows accepted
  once she has answered — and nothing rings meanwhile; what either kind of call has told is
  one set for the page (`toldWork`), so neither repeats the other. A bot can still be picked
  in the line during it, for one message. Esc or a spoken call ends it; a spoken
  call has the line to itself, so what is typed then goes to a bot, and a file put down then
  reaches the call as a fact the way a screen answer does (`screenActs`), never as an
  instruction.

# Rules

- Timestamps are `DateLike` (`lib/date-like`): ISO strings on the wire, `Date` in drizzle.
  `z.coerce.date()` lies on the client.
- File route handlers receive decoded path segments; viewer pages receive encoded segments in
  this Next.js version. Use `decodePath` for handlers and `decodePagePath` for pages, exactly once.
- Shared logic goes to `lib/utils.ts` or the matching lib file before it is written twice. Don't
  generalize something used once.
- Verify with `pnpm typecheck` and `pnpm lint`; client/server boundary changes also require
  `pnpm build`, because TypeScript does not validate Next.js directives. Schema changes:
  `pnpm db:generate` (applied at boot), `pnpm db:migrate` for the current DB. Never `drizzle-kit push`.
- Prompt or tool-description changes: read the assembled result, not just the file. UI changes: run
  the app and look. Judge bot behavior by counting stored turns and tool calls, not by feel.
- Comments are English, present tense and short. They explain what the code cannot: an invariant, an
  external constraint, the one-line why behind a surprising choice. No history, no narrative.
- Model-facing text (prompts, tool descriptions, `.describe()`) is English and imperative.
- A change the user would notice — a screen, a setting, what a call or a bot can do — updates
  `guide/` in the same commit. It is what Thursday reads when an answer depends on the app, and
  a guide that describes a screen the app no longer has is answered aloud with confidence.
- A new file you created goes in the commit with the rest of your change — which is why anything
  private is named `*.local.*` before it is written, not after. Two are easy to get wrong: a
  generated migration (`database/migrations/…`) MUST be committed or a fresh clone boots against
  the wrong schema, and a stray shell redirect at the repo root must not be.
- **Keep this file true.** When a change makes a line here wrong, fix it in the same commit; when
  it settles something new and non-obvious, add it. Delete what the code no longer does — a stale
  rule is followed as confidently as a live one.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
