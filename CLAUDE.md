# thursday

A local-first voice agent. A realtime speech model ("Thursday") holds the call and only touches
what can be answered in a glance (memory, one file). Anything that takes time — MCP, skills,
a browser, minute-long jobs — is delegated to text-model bots that run in the background with a
shell, a browser and skills. Jobs outlive the call: they run on the server, and the screen is a
projection of server state.

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

# Layout

```
features/<name>/          One domain: its data and its screens. A new feature copies this shape.
  <name>.schema.ts        zod is the source of types (z.infer). No server-only imports (used on both sides).
  <name>.query.ts         DB access. drizzle is used here only; screens, actions and tools all call this.
                          Writes emit appEvents here, so every caller notifies the same way.
  <name>.action.ts        "use server" + serverAction. Writes.
  <name>.*.ts             run / manager / store files when the domain needs them.
                          A second query file (`task.query.ts`, `tidy.query.ts`) when one table is its own subject.
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

**Shipping** — `next build` writes a standalone server; `scripts/pack.mts` turns it into `dist/`, which
is what `npm publish` takes. Three things about npm shape the app: it deletes every folder named
`node_modules` from a tarball unless the package declares it bundled (so pnpm installs hoisted,
`pnpm-workspace.yaml`, and pack lifts Turbopack's `.next/node_modules` aliases one level up); it gates
install scripts, so the package has none — nothing may stand between `npx` and a running app, and what
an install used to fetch is fetched at boot instead (`workspace.ensureBrowser`), in the background; and
a published tree carries no source, so anything read by name at run time (skills, migrations) is named
in `outputFileTracingIncludes`, not left to the trace.

# Conventions

- **Domains hold data, `features/ai` holds the model.** A domain folder has schema, query, action and
  components and knows nothing about models. Tools, prompts and model-facing names all live in
  `features/ai/`. The only code that calls into `features/ai` is what actually runs a model
  (`bot.run`, `bot.runner`, `thursday.action`).
- **Tool names come from one file.** `features/ai/tools/tool-name.ts` is the source; tools and prompts
  import it. schema/query files never contain a tool name.
- **Prompts are split by runtime, not by chapter.** Each prompt file loads its own data and exports one
  function. Shared helpers only format rows; they never decide what to say. Tool descriptions say
  *what* a tool is; prompts say *when* to use it. Prompts are assembled per session, never cached.
- **Tools run on the server.** A call's tool invocation is forwarded by the page to the server, so tools
  call domain queries directly. The one exception is anything that touches the call itself (hang up).
- **Long-running work continues after the response** (`after`). Everything that happens is written as
  rows, so what the screen draws and what the model re-reads are the same rows.
- **Memory is re-read after calls, one call per context.** `features/memory/memory.tidy` runs a text
  model over calls after the fact; the unit is one call (a long one in parts), the checkpoint is
  `call.tidied_at`, and the trigger is pending transcript size plus a quiet line, never a call count.
- **No browser, nothing runs.** `presence` (app/api/events) says whether a browser is on the stream;
  when the last one has been gone a while, jobs stop and wait, the tidy pass stops, open calls close.
  Wired once at boot (`instrumentation`), not in each domain.
- **What cannot be won by instruction is enforced by structure**: tool sets, step limits, ask-back
  counts, output truncation, shell env. Do not add prompt sentences for things the code can enforce.
- **Vocabulary belongs to whoever produces it.** Band counts come from the tap that fills them,
  provider lists from where the drivers live. No re-export doors. A domain's glyph is vocabulary too:
  it lives in `features/<d>/components/<d>-mark.tsx`, and the settings nav and the call screen's tool
  line both import that one. A second icon table is how they end up disagreeing. So is a domain's
  nav badge: `features/<d>/components/<d>-badge.tsx` reads that domain's own key and draws
  `NavBadge`. It loads with the app, so it never lives in the lazily-loaded setting screen.
- **Settings screens live in their domain** (`features/<d>/components/<d>-setting.tsx`).
  `features/settings/` holds only the shell (nav, dialog) and shared setting grammar. The shell
  gives a section the space under the header; the section fills it and draws its own scroll area,
  so it picks a width and ends in a rail:
  - `SettingScreen width` — `list` (880) for rows that are a label and its value, `narrow` (600)
    for Thursday, `full` for readers, rosters and the log. `SettingPanes` is the two-pane form
    (Memory, Bots); both panes reach the bottom edge, so nothing clips.
  - `SettingRail` is the bottom edge of every section: what the whole set is, plus the actions
    that act on all of it. It also gives a short section a bottom, so the empty half of a tall
    dialog reads as margin rather than a truncated page.
  - A card (`SettingItems`) holds a finite set; a log (Tasks, history) runs to the bottom edge as
    dividers only. A group label (`SettingGroup`) is plain text above its card, never a tinted band.
  - A row's second line is its state, not a second name for it. Any list that grows carries a
    `SettingFilter`; Cmd+K focuses it, Cmd+1..8 jump sections, arrows move inside the nav.
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
- Notifications: `toast.add`, only for things that happen off-screen. Skip it when the result is visible.
- Waiting is always a loader: buttons swap their icon for a Loader, lists use `Skeleton`. Never dots
  or pulses, and never a new element that shifts the row when it finishes.
- Two status colors only: amber (waiting on me — `WAITING_INK` in `lib/utils`) and red (failed —
  `text-destructive`). Success, connected and enabled have no color. There is no brand color, so a
  green would become one. The settings nav reports the same two and nothing else (`NavBadge`).
- Errors are never swallowed. Inline or toast, they reach the user.

# Rules

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
- New files go in the commit (`git add -A`).
- When a structural decision changes, update this file in the same diff.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
