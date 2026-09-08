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
- **Memory is re-read after calls.** `features/memory/memory.tidy` runs a text model over what was
  said once `MEMORY_TIDY.messages` turns are owed; that same number is the window, so one read is
  one context over the most recent turns and older calls are stamped unread rather than queued.
  The checkpoint is `call.tidied_at`. The trigger is turns owed, never a call count: a greeting and
  an hour's talk are both one call.
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
  - **One column** (`SettingColumn`, centred, 880) carries the section title, a list body, the
    skeleton and the rail's words — the same on every section, so nothing moves when the section
    changes. A per-section width was tried and reverted: it moved the title and the skeleton on
    every switch, which reads as three designs rather than one.
  - **What is a surface fills the section instead**: a reader's panes (`SettingPanes` — Memory,
    Bots, Workspace) and every rail's rule go edge to edge. Both panes reach the bottom edge, so
    nothing clips, and the rail below them is the section's, not a pane's.
  - **A section waits in the shape it arrives in.** `SettingSkeleton` is the column's;
    `SettingPanesSkeleton` is the panes', built out of `SettingPanes` so the two cannot drift.
    Both waits use it — the section's own read and the chunk (`lazySection`'s second argument) —
    or opening one section draws two layouts. Neither belongs in a dialog: a dialog has its own
    padding, so it waits as plain `Skeleton` lines shaped like what is coming.
  - `SettingRail` is the bottom edge of every section: what the whole set is, plus the actions
    that act on all of it. It also gives a short section a bottom, so the empty half of a tall
    dialog reads as margin rather than a truncated page. **What cannot be undone is not a rail
    action**: the rail is on screen the whole time a section is open, so a wipe sits at the foot
    of the body as a `Danger zone` group and is reached by scrolling to it (Thursday's Reset
    history). A panes section has no body to put one in, so its rail keeps that action
    (Workspace's Empty scratch).
  - **Every list in a section body is the same card** (`SettingItems`), however long it runs:
    Tasks was a full-bleed log of dividers and read as a different app one nav row over.
    Dividers-only belongs where there is already a surface — a reader's pane, a dialog.
    A group label (`SettingGroup`) is plain text above its card, never a tinted band.
  - **`SettingGroup` is the only shape a section is built from**: a header line (label, its
    `hint`, a `filter`, and the set's state at the far end), a body, and a `note` under it —
    never that markup written out by hand. A switch that runs something by itself is
    `SettingToggle`; a line that qualifies a body is `SettingNote`.
  - **One spacing rhythm, set in `setting-ui.tsx` and nowhere else**: 32px between groups, 12px
    from a label to its body, 8px from a body to the note about it. What reads as cramped is the
    ratio, not the numbers — a group 20px from its neighbour and 8px from its own label leaves
    the label floating between two cards instead of belonging to one.
  - A row's second line is its state, not a second name for it, and stays tight; a sentence that
    wraps gets its own leading. Any list that grows carries a `SettingFilter` — on its group's
    header line when it filters that group, on the section's (`SettingToolbar`) when it filters
    more than one. Cmd+K focuses it, Cmd+1..9 jump sections, arrows move inside the nav.
- **Artifacts and Workspace are two sections because they answer two questions.** Artifacts
  (`features/artifact`) lists **the top of `artifacts/` only, one entry per row** — which is
  already how the bots file things: a skill writes `artifacts/<name>.html`, a job that makes a set
  writes `artifacts/<name>/`. So the folder is the index; nothing is recorded, and no artifact is
  attributed to a job. The menu is flat and newest-first, and **a folder does not open into another
  listing** — it opens as a sheet of what it holds, which is what a set of pictures is for.
  Navigating a tree, and everything a bot wrote that is not finished work, is Workspace's. Both
  open files through the same `FilePreview`, so the caps below hold in both.
- **`file-kind.ts` decides what the Workspace section shows.** A file's `viewKindOf` says how the
  screen opens it *and* whether it is listed at all — a kind of `none` is never listed — and
  `isListedFolder` says the same for folders: hidden ones and what a package manager installs are
  machinery, not work. Giving an extension a kind puts it on that screen; taking one away removes it.
- **Nothing in the Workspace section is recursive.** A folder's size is every file under it, and a
  bot that ran one `pnpm install` puts 16,000 of them in the tree — so no folder is measured and
  no total is summed. One `readdir` per folder, one `stat` per file actually drawn, capped at
  `WORKSPACE_VIEW.rows` with the rest behind Show more, so a folder of twenty and a folder of
  twenty thousand cost the same. Only files carry a size, because one `stat` is free. `du`
  questions go to Reveal folder. What the browser is handed is capped the same way
  (`WORKSPACE_VIEW.textMax` / `elementMax`): text arrives as a Range and says it is a head, and an
  image or page past the cap is not drawn at all — an `<img>` decodes whole and a dead tab
  explains nothing. Audio and video are uncapped; they stream.
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
- Notifications: `toast.add`, only for things that happen off-screen. Skip it when the result is visible.
- Waiting is always a loader: buttons swap their icon for a Loader, lists use `Skeleton`. Never dots
  or pulses, and never a new element that shifts the row when it finishes.
- Two status colors only: amber (waiting on me — `WAITING_INK` in `lib/utils`) and red (failed —
  `text-destructive`). Success, connected and enabled have no color. There is no brand color, so a
  green would become one. The settings nav reports the same two and nothing else (`NavBadge`).
- Errors are never swallowed. Inline or toast, they reach the user.
- **A task's thread is a room its own bot owns** (`bot-room.tsx` `Conversation`). That bot holds the
  left; everyone it talks to — Thursday, and any bot it delegated to — answers from the right, and
  one 80% cap sits on the turn's column so a report and a one-line remark end on the same edge.
  A bot arriving is a centred system line (`Invite`), drawn once, where an `ask` first names it —
  not an arrow on somebody's message, and never on the way back: after that the side and the face
  say who is speaking, the way a group chat does. **The report is not a card**: it is already inside
  a thread inside a section, and a third border reads as a second chat window. What tells it from a
  passing remark is that it is the only prose there at foreground weight, plus the files it names.
  Who was in the room is `rosterOf` — derived from the lines, never a table.

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
- New files go in the commit (`git add -A`) — which is why anything private must be named
  `*.local.*` before it is written, not after. Two things are easy to get wrong the other way:
  a generated migration (`database/migrations/…`) MUST be committed or a fresh clone boots
  against the wrong schema, and a stray shell redirect at the repo root must not be.
- Commit and pull-request titles are [conventional commits](https://www.conventionalcommits.org)
  (`feat:`, `fix:`, `docs:`, `refactor:`, `chore:`, `feat!:`). Not a style preference:
  release-please reads them to decide the next version and write CHANGELOG.md, so a feature
  landing under `chore:` never ships. Never hand-edit `CHANGELOG.md`, `package.json`'s `version`
  or `.release-please-manifest.json` — a release is a merged Release PR, never a pushed tag.
- When a structural decision changes, update this file in the same diff.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
