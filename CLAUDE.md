# thursday

A local-first voice agent. A realtime speech model ("Thursday") holds the call and only touches
what can be answered in a glance (memory, one file). Anything that takes time — MCP, skills,
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
- **Anything private is named `*.local.*`** — a scratch note, a task list, a plan, a local
  override. `.gitignore` covers that shape, so a file named this way can never be committed by
  accident. `ux.local.md` is the working example. Never `git add -f` one, and never rename one
  into the tree to "keep it for later"; if it is worth keeping, it is worth writing properly.

# Layout

```
features/<name>/          One domain: its data and its screens. A new feature copies this shape.
  <name>.schema.ts        zod is the source of types (z.infer). No server-only imports (used on both sides).
  <name>.query.ts         DB access. drizzle is used here only; screens, actions and tools all call this.
                          Writes emit appEvents here, so every caller notifies the same way.
  <name>.action.ts        "use server" + serverAction. Writes.
  <name>.*.ts             run / manager / store files when the domain needs them.
                          A second query file (`task.query.ts`) when one table is its own subject.
  components/             Screens for this domain only, including its settings panel.
features/ai/              Everything the model sees. Composes domain query/schema into prompts and tools.
  tools/<name>.tool.ts    One tool per file: name, description, args, execute. Execute calls the domain query.
  tools/tool-name.ts      Every name the model sees. Tools and prompts both import from here.
  prompts/thursday.prompt.ts  Everything the call hears; loads its own data and assembles the prompt.
  prompts/bot.prompt.ts       Everything a bot hears. Shares no text with the call prompt.
  prompts/prompt-helper.ts    Voice-less helpers: row-to-line formatters and a few thresholds.
  load-tools.ts           Which runtime holds which tools (ToolRun).
  model.ts / model.schema.ts   Which model runs, and how it is built.
app/                      Routing shell only. api/<d>/route.ts is one serverRoute line.
  api/query-key.ts        Every endpoint the client reads. Lives next to the routes so they move together.
  api/events/             The server→browser event union and the SSE route.
components/ui/            Domain-agnostic UI (shadcn).
hooks/                    Domain-agnostic React hooks.
lib/                      Domain-agnostic only: protocol/ (Result, actions, routes, SWR, event bus),
                          realtime/ (the call seam), sandbox.ts (interface + creator), queue, tokens, limits, utils.
database/db.ts            The one client, and the lane every request goes through (SQLite has one writer).
database/tables.ts        All drizzle tables (relations and migrations look at one place).
config.ts                 App knobs: name, the two roots, paths, page sizes, limits. Not secrets (features/config).
bin/                      What ships and runs outside Next: the `thursday` CLI and where the app's own
                          CLIs are. Plain .mjs — it runs before anything is built.
scripts/reset.mts         Wipes local data (calls, jobs, memory) and optionally the build. `pnpm reset`.
scripts/pack.mts          Builds `dist/`, the tree npm publishes. `pnpm release`.
skills/                   Skills shipped with the app (read-only). User skills live in the workspace.
```

Two roots (`config.ts` `APP_DIR` / `DATA_DIR`): the app's files (build, migrations, bundled skills) and
the user's files (DB, workspace, installed skills). Both default to `process.cwd()` and can be moved
with `THURSDAY_APP_DIR` / `THURSDAY_HOME`. Nothing else reads `cwd`; every path goes through `config.ts`.
`npx thursday-agent` is the same two roots pointed elsewhere: the package for one, `~/.thursday` for
the other (`bin/thursday.mjs`). It is why the app is publishable at all — nothing writes beside itself.

Anything past that lives in one skill, `.claude/skills/thursday/`, read when you are inside the area
it covers — prompts and the bot runtime, screens, the database, shipping. Its `SKILL.md` says which
file to open for what. Keep it true the same way you keep this file true.

# Conventions

- **Domains hold data, `features/ai` holds the model.** A domain folder has schema, query, action and
  components and knows nothing about models. Tools, prompts and model-facing names all live in
  `features/ai/`. The only code that calls into `features/ai` is what actually runs a model
  (`bot.run`, `bot.runner`, `thursday.action`).
- **Tool names come from one file.** `features/ai/tools/tool-name.ts` is the source; tools and
  prompts
  import it. schema/query files never contain a tool name.
- **Prompts are split by runtime, not by chapter.** Each prompt file loads its own data and
  exports one
  function. Shared helpers only format rows; they never decide what to say. Tool descriptions say
  *what* a tool is; prompts say *when* to use it. Prompts are assembled per session, never cached.
- **Tools run on the server.** A call's tool invocation is forwarded by the page to the server, so
  tools
  call domain queries directly. The one exception is anything that touches the call itself (hang up).
- **Long-running work continues after the response** (`after`). Everything that happens is written as
  rows, so what the screen draws and what the model re-reads are the same rows.
- **No browser, nothing runs.** `presence` (app/api/events) says whether a browser is on the stream;
  when the last one has been gone a while, jobs stop and wait and open calls close.
  Wired once at boot (`instrumentation`), not in each domain.
- **What cannot be won by instruction is enforced by structure**: tool sets, step limits, ask-back
  counts, output truncation, shell env. Do not add prompt sentences for things the code can enforce.
- **Vocabulary belongs to whoever produces it.** Band counts come from the tap that fills them,
  provider lists from where the drivers live. No re-export doors. A domain's glyph is vocabulary too:
  it lives in `features/<d>/components/<d>-mark.tsx`, and the settings nav and the call screen's tool
  line both import that one. A second icon table is how they end up disagreeing. So is a domain's
  nav badge: `features/<d>/components/<d>-badge.tsx` reads that domain's own key and draws
  `NavBadge`. It loads with the app, so it never lives in the lazily-loaded setting screen.
- **A number that tunes behaviour is in `config.ts`; a number that *is* the drawing stays where it
  is drawn.** A cap, a deadline, a page size, a step limit, how long something is kept — named in
  `config.ts` with a paragraph saying what moving it does, even when one file reads it. An easing
  time, a radius, a sample rate, a wire timeout the other end also knows: local. The test is who
  the number answers to — the person tuning the app, or the thing being drawn.
- **A tool two runtimes share names no tool in what it returns.** `memory_recall` answers the call
  and a bot. Past `MEMORY_LIMITS.factsPerNote` it says the note has outgrown its size and to ask the
  user what to drop — the ask, which both can act on, never the mechanism: only one of them has a
  screen to put a note on, and how is the call prompt's to say.
- **Don't split files by size.** A long file that does one thing stays one file.
- **An interface with one implementation is two files, not an interface.** Don't add ports.

# Data flow

**Read** — RSC first. Server components call `<name>.query.ts` directly. Client reads go through
`app/api/<d>/route.ts` (`serverRoute(() => findAll())`) and `useServerRoute`:

```ts
const { data, mutate } = useServerRoute<MemoryNote[]>(queryKey.memory);
const { data } = useServerRoute<MemoryNote>(queryKey.note(id)); // null id pauses
```

Beyond the key it is plain SWR. Responses are typed, not validated at runtime. Read failures toast
from the hook. SWR is for revalidation and dedup, not caching.

**queryKey** — never write a URL in a screen. All keys live in `app/api/query-key.ts`:

```ts
export const queryKey = {
  memory: "/api/memory",
  note: (id: number | null) => ({ url: "/api/memory", pathVariable: [id] }),
} as const;
```

The key is the SWR cache key. `revalidate` matches by URL prefix, so invalidating `queryKey.memory`
also refreshes `queryKey.note(id)`. Invalidation is done by the writer's `onOk`, not by the action hook:

```ts
const [create] = useServerAction(createNoteAction, {
  onOk: (note) => {
    revalidate(queryKey.memory);
    openMemoryNote(note.id);
  },
});
```

**Write** — no routes. Only server actions wrapped in `serverAction`. Routes exist for three cases:
external callers hitting a URL (oauth callback), work that must run in parallel (tool calls during a
call — actions are serial per client), and server→browser streams (SSE).

```ts
export const createNoteAction = serverAction(async (path: string) => {
  const parsed = PathSchema.parse(path); // validate inside; ZodError messages reach the UI
  const note = await createNote(parsed);
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
raises it public rather than letting the boundary swallow it: `issueClientSecret` (lib/realtime) for
the call's token, `modelErrorToString` (features/ai/model) for anything the ai sdk wrapped, which also
carries out the body when the sdk's message is the status word alone.

**Server → browser** — no polling. When a fact happens on the server (a row was written, a browser
opened, something to say), `appEvents.emit` at that spot; the browser listens on one SSE stream. Two
kinds of events: a **signal** when a GET exists (the receiver `revalidate`s that key) and **data** when
none does. New event = one union line + one emit + one handler (+ one `SIGNALS` entry for signals; the
compiler enforces it). Emit where the fact happens (the query's write, the watcher), not in each caller.
A 30-second poll remains as a safety net. No WebSockets.

# UI

- Domain-agnostic components are shadcn (`components/ui/`). Check there before writing a new one.
- Markdown renders through `markdown.tsx` (wraps streamdown).
- Confirmations and prompts: `notify.confirm` / `notify.prompt`. Destructive actions confirm first.
- Notifications: `toast.add`, only for things that happen off-screen. Skip it when the result is
  visible.
- Waiting is always a loader: buttons swap their icon for a Loader, lists use `Skeleton`. Never dots
  or pulses, and never a new element that shifts the row when it finishes.
- Two status colors only: amber (needs me — a question, a stopped job, an answer not yet opened;
  `WAITING_INK` in `lib/utils`) and red (failed — `text-destructive`). Success, connected and enabled
  have no color of their own: an unopened answer is amber because it waits on me, not because it
  worked. There is no brand color, so a green would become one. The settings nav reports the same two
  and nothing else (`NavBadge`).
- Errors are never swallowed. Inline or toast, they reach the user.

# Rules

- **Say what you are about to change, and wait.** Investigating is free — read, grep, query the
  local database, measure. Editing a file, spending a real model call on the user's key, or
  writing into the tree is not. A question is a question, not approval.
- **Several agents work here at once, and a dev server is usually running.** Stage only the files
  you touched, by name — never `git add -A`, which sweeps in someone else's half-finished work.
  Re-read a file before editing it: if it changed under you, that is the current state, not a
  mistake to undo. Never revert an uncommitted line you did not write, and never commit on
  someone's behalf.
- Timestamps are `DateLike` (`lib/date-like`): ISO strings on the wire, `Date` in drizzle.
  `z.coerce.date()` lies on the client.
- Shared logic goes to `lib/utils.ts` or the matching lib file before it is written twice. Don't
  generalize something used once.
- Verify with `pnpm typecheck` and `pnpm lint`. Schema changes: `pnpm db:generate` (applied at boot),
  `pnpm db:migrate` for the current DB. Never `db:push`.
- Prompt or tool-description changes: read the assembled result, not just the file. UI changes: run
  the app and look. Judge bot behavior by counting stored turns and tool calls, not by feel.
- Comments are English, present tense and short. They explain what the code cannot: an invariant, an
  external constraint, the one-line why behind a surprising choice. No history, no narrative.
- Model-facing text (prompts, tool descriptions, `.describe()`) is English and imperative.
- A new file you created goes in the commit with the rest of your change — which is why anything
  private is named `*.local.*` before it is written, not after. Two are easy to get wrong: a
  generated migration (`database/migrations/…`) MUST be committed or a fresh clone boots against
  the wrong schema, and a stray shell redirect at the repo root must not be.
- **Keep this file and the skill true.** When a change makes a line here wrong, fix it in the same
  commit; when it settles something new and non-obvious, add it. Short entries here, the long ones
  in the skill. Delete what the code no longer does — a stale rule is followed as confidently as a
  live one.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
