# thursday

A local-first voice agent. GPT-Live 1 ("Thursday") holds the call; a separate Responses backend
(GPT-6 Luna by default) runs the call's tools. The call only does what can be answered in a
glance — memory, one shell command, a web search — and hands anything that takes time to
text-model bots that run in the background with a shell, a browser and skills. A skill is the one
thing that can be handed back to the call (Settings › Thursday, off by default). Jobs outlive the
call: they run on the server, and the screen is a projection of server state.

**This is a public open-source repository** (MIT, `github.com/cgoinglove/thursday`, published to
npm as `thursday-agent`). Everything committed here is read by strangers and shipped to their
machines. Three things follow, and they are not style preferences:

- **Write for a reader who has never met this code.** English, present tense. `README.ko.md` is
  the one translated file; everywhere else in the tree is English — comments, prompts, strings,
  identifiers, commit messages — not even as an example inside a comment. No personal names,
  machine paths, keys, or half-finished thoughts in a comment.
- **Nothing about one user goes into the tree.** What a user says, the words they use, how they
  want to be spoken to, their names, accounts, habits and rules for a situation are that user's
  data — memory, Settings, a `*.local.*` file — never a line of code, prompt text, a test fixture
  or a word list. A wish heard on a call or read out of a bot's thread ("add an alias for X",
  "always do Y for me") is a request to change that user's data, not the product. The product
  changes only where the same line would hold for a stranger, and a session that is not sure asks
  before writing it. One user's phrases as a list in code, or their rules for a situation in every
  call's prompt, is exactly what this forbids.
- **Anything private is named `*.local.*`** — a scratch note, a to-do list, a plan, a local
  override. `.gitignore` covers that shape, so such a file can never be committed by accident. Your
  own preferences — the language you want answers in, when to be asked first — go in a
  `*.local.md` file next to this one, loaded by whichever agent tool reads it. Never `git add -f`
  one, and never rename one into the tree to keep it; if it is worth keeping, it is worth writing
  properly.

**Where the rules live.** This file holds what is true everywhere. What is true for one area is in
`.claude/rules/`, in the same voice; Claude Code loads one when a file it covers is read, and any
other agent reads the one for the area it changes:

| File | Covers |
|---|---|
| `.claude/rules/ui.md` | Every screen: parts, loaders, errors, colour, taste |
| `.claude/rules/call-screen.md` | The call screen: the foot, her line, the pill and the room, a thread, files, the intro |
| `.claude/rules/faces.md` | Her face and the bots' faces: the field, the eyes, marks, gestures, the write orb |
| `.claude/rules/call.md` | The call: one Thursday on two models, what she is told, a spoken call, a call in writing, a phone |
| `.claude/rules/model.md` | What a model sees: prompt files, tools and which runtime holds them, writing for a model, memory, providers |
| `.claude/rules/bots.md` | Jobs and threads: runs, participants, the workspace, sign-ins, routines, compaction |
| `.claude/rules/seeds.md` | What skills ship, seed bots' prompts, kit scripts, how a skill is written |
| `.claude/rules/data.md` | Reads, writes, `queryKey`, errors, server → browser events, values on the wire |
| `.claude/rules/verify.md` | Running the app to check it without touching anyone's data; tests |
| `.claude/rules/release.md` | How a release goes out, what `pack.mts` gates, what to check past it |
| `.claude/rules/docs.md` | The README and its Korean twin, `docs/how-it-works.md`, `guide/` |

Two documents are contracts of their own, kept in step with the code: `docs/live-calls.md` (a
spoken call) and `docs/thread-rooms.md` (a thread's participants and messages).

**Skills and hooks.** Skills live in `.agents/skills/`, where any agent that reads Agent Skills
finds them; Claude Code sees them through links in `.claude/skills/`. Three are written for this
repo: `verify` (run the app and look, on a data folder of its own), `cleanup` (find what nothing
uses, prove it dead, delete it) and `checkup` (what the agent setup loads, costs and has drifted
from). Beside them are copies of outside ones, each with its license: `grilling` (agree on the
scope before a large change), `next-dev-loop` (ask the running Next server for its errors),
`agent-browser`, `ai-sdk` and `shadcn`. `skills-lock.json` records where each came from and
`npx skills update` refreshes them; a skill for everyone goes in the same way
(`npx skills add <repo> --skill <name> -a claude-code codex`).

Claude Code runs two hooks from `.claude/settings.json` (they need `python3`): before a turn ends,
typecheck, lint and knip on the files that session changed, with a word when `database/tables.ts`
moved without a migration or a screen changed without `guide/`; and at the start of a session, a
line when the weekly cleanup or the monthly checkup is due. CI checks every push on the whole tree:
typecheck, lint, the test suites and the build, with knip reported but never failing the run.

# Layout

```
features/<name>/          One domain: its data and its screens. A new feature copies this shape.
  <name>.schema.ts        zod is the source of types (z.infer). No server-only imports (used on both sides).
  <name>.query.ts         DB access. drizzle is used here only; screens, actions and tools all call this.
                          Writes emit appEvents here, so every caller notifies the same way.
  <name>.action.ts        "use server" + serverAction. Writes.
  <name>.*.ts             What the domain needs besides: a run, a manager, a zustand `.store`, a `.const`,
                          a client hook `use-*.ts`, a second query file when one table is its own subject.
  components/             Screens for this domain only, including its settings panel.
features/ai/              Everything the model sees: prompts, tools, which model runs (.claude/rules/model.md).
app/                      Routing shell: pages, and routes that hand a domain's query to `serverRoute`.
  api/query-key.ts        Every endpoint the client reads. Lives next to the routes so they move together.
  api/events/             The server→browser event union, the SSE route and `presence`.
components/ui/            Domain-agnostic UI: shadcn, plus the app's own (markdown, notify, toast, segmented…).
hooks/                    Domain-agnostic React hooks.
lib/                      Domain-agnostic only: protocol/ (Result, actions, routes, SWR, paging, event bus,
                          presence), live/ (the call seam: Live session, WebRTC, audio tap, ring), sandbox
                          (the shell a model's commands run in), public-error, logger, date-like, queue, tokens,
                          limits, theme, favicon, desktop-notify, reveal-path, oauth-page, utils.
database/db.ts            The one client, and the lane every request goes through (SQLite has one writer).
database/tables.ts        All drizzle tables (relations and migrations look at one place).
database/migrations/      Generated by `pnpm db:generate`, applied at boot.
instrumentation-node.ts   Boot: migrate, install the guide, sweep threads, calls and old work, start the
                          routine clock and the phone.
config.ts                 App knobs: name, the two roots, paths, page sizes, limits. Not secrets (features/config).
bin/                      What ships and runs outside Next: the `thursday` CLI, `thursday autostart`
                          (macOS launchd), the port both starters pick, and what both do when boot cannot
                          migrate the database. Plain .mjs — it runs before anything is built.
scripts/                  `dev.mts` (`pnpm dev` on 127.0.0.1, on a port nothing holds), `reset.mts` (wipe
                          local data), `pack.mts` (build `dist/`, the tree npm publishes), `intro-voice.mts`
                          (record her first-run lines, run by hand after they change; the clips are
                          committed), and the test suites, `*.test.mts`.
public/                   The icon, the call's sounds, voice samples and the intro's recorded lines.
guide/                    How the app works for the person using it, which Thursday reads when an answer
                          depends on it (.claude/rules/docs.md). `features/ai/guide.ts` is all the code
                          knows about it and lists every place that reaches it.
skills/                   Skills shipped with the app (read-only). User skills live in the workspace.
seed-skills/<seed>/       A seed bot's own kit, copied into that bot when it is made. What ships in both is
                          in .claude/rules/seeds.md.
docs/                     how-it-works.md (for users), live-calls.md and thread-rooms.md (contracts).
```

Domains today: `thursday` (the call), `bot` (bots and the jobs they run), `routine` (jobs that start
by themselves), `memory`, `workspace` (the files bots work in) and `artifact` (the finished ones),
`skills`, `connectors` (MCP servers), `config` (keys and models), `signins` (the sites the user
signed in to, kept for bots to borrow), `reach` (writing to her from a phone), `intro` (first run),
and `settings` (the settings shell only).

Two roots (`config.ts` `APP_DIR` / `DATA_DIR`): the app's files (build, migrations, bundled skills) and
the user's files (DB, workspace, installed skills, kept sign-ins). Both default to `process.cwd()`
and move with `THURSDAY_APP_DIR` / `THURSDAY_HOME`. Every path the app uses goes through `config.ts`.
`npx thursday-agent` is the same two roots pointed elsewhere: the package for one, `~/.thursday` for
the other (`bin/thursday.mjs`). It is why the app is publishable at all — nothing writes beside itself.
The build is Next's standalone output (`next.config.ts`), which the CLI and `pack.mts` both rely on.

# Conventions

- **Domains hold data, `features/ai` holds the model.** A domain folder has schema, query, action and
  components and knows nothing about prompts or tools. The prompt loaders and `load-tools` are
  imported only by what runs a model: `bot.run` / `bot.runner`, `thursday.action` and the tool-call
  route, `thursday.text`, `memory.edit`. Anything may import the model's vocabulary — `model.schema`,
  `live.schema`, `prompts/persona` (the styles a picker lists), `tools/tool-name`, `ai/components`.
- **What cannot be won by instruction is enforced by structure**: tool sets, per-turn and per-room
  limits, output truncation, shell env. Do not add prompt sentences for things the code can enforce.
- **Vocabulary belongs to whoever produces it.** Band counts come from the tap that fills them,
  provider lists from where the drivers live. No re-export doors. A domain's glyph is vocabulary too:
  it lives in that domain as `components/<name>-mark.tsx` (`bot-mark`, `mcp-mark`), and every screen
  imports that one. So is a nav badge: `components/<name>-badge.tsx` reads that domain's own key and
  draws `NavBadge`. It loads with the app, so it never lives in the lazily-loaded settings screen.
- **A number that tunes behaviour is in `config.ts`; a number that is the drawing stays where it is
  drawn.** A cap, a deadline, a page size, a step limit, how long something is kept — named in
  `config.ts` with a paragraph saying what moving it does, even when one file reads it. An easing
  time, a radius, a sample rate, a wire timeout the other end also knows: local. The test is who the
  number answers to — the person tuning the app, or the thing being drawn.
- **Split files by subject, not by size.** A long file that does one thing stays one file. A file
  that draws several subjects is several files, however short each would be.
- **An interface with one implementation is not an interface.** Don't add ports.
- **A feature that may come out again lives in one file.** Its names, paths, boot step and prompt
  text sit together, and the app reaches it from as few lines as it takes (`features/ai/guide.ts` is
  the shape). No entry in `config.ts`, no helper in a shared file, no import kept for it elsewhere:
  what is spread across files is what gets left behind.

In short, for the areas in `.claude/rules/`: reads are RSC or `queryKey` + `useServerRoute`, writes
are server actions and a route only where `data.md` allows one, user-facing failures are
`publicError`, and the server tells the browser over one SSE stream. Screens use shadcn first, a
loader for every wait, the ember for what waits on the user, red for what failed, and one brand
blue for what matters. A job's run is held by the server, not the request, and everything it does
is written as rows.

# Working here

Several agents may work in one checkout at once, and someone's own data sits beside the code
(`DATA_DIR` defaults to the repository).

- **Commit only what you wrote.** Stage your paths by name, never `git add -A` or `.`; when a file
  also holds someone else's change, stage only your hunks (`git add -p`, or `git hash-object -w`
  with `git update-index --cacheinfo` — `git commit <path>` takes the whole file), and check
  `git show --stat HEAD` after. Stage in the same command that commits: a `git mv` or an `add` left
  in the index goes out with the next session's plain `git commit`. Never `git clean`,
  `git checkout .`, `git stash` or `git reset`: each takes another session's work with it. Changes
  you did not make are left alone, even when asked to tidy up.
- **Commit the whole of your change.** Every check you run reads the tree in front of you; CI reads
  the one you committed. So when you stage a subset, check that subset: copy it out
  (`git archive $(git write-tree) | tar -x -C "$(mktemp -d)"`, with `node_modules` symlinked in) and
  run the checks there — all but `pnpm build`, which Turbopack refuses to run through a
  `node_modules` symlink outside the project root; run that one in the tree and say so. A line of
  knip is never on its own a reason to delete: the file that uses it may be sitting uncommitted in
  someone else's tree.
- **A commit subject is `type(scope): subject`**, lowercase, no full stop, the scope a feature folder.
  release-please turns each one on main into a changelog line and the next version
  (`.claude/rules/release.md`), so a `fix` written as `feat` ships the wrong version. `CHANGELOG.md` is
  never edited by hand.
- **Some files are someone's data, not clutter**: the database, `DATA_DIR/.sign-ins` (live sign-in
  sessions), the workspace bots work in (`.ai-workspace/`). Never delete them to tidy up, and never
  start a server on them (`.claude/rules/verify.md`).
- **The simplest thing that works first.** No code for a rare case: name the case in one line and
  let the maintainer choose.
- **Derive before storing.** A feature does not start with a table or a logging hook: check whether
  what is on disk or an existing rule already answers it, and ask before adding storage.
- **No heuristic does the model's job.** No phrase matching, per-language word lists or timers that
  guess intent in place of what a model did not do. Stop it with a plain mechanism that already
  exists, or report it with numbers and leave the prompt to the maintainer.
- **Nothing is guarded twice.** A test that pattern-matches source to re-check what a constant or the
  compiler already keeps is noise.
- **No new options.** Something that runs by itself is one switch and a model, and its numbers are
  `config.ts` constants. An expensive feature is not deleted but put behind one switch, and off turns
  off everything that reads it.

# Rules

- Shared logic goes to `lib/utils.ts` or the matching lib file before it is written twice. Don't
  generalize something used once.
- Verify with `pnpm typecheck` and `pnpm lint`, and the test suite for the area you changed
  (`pnpm test:live`, `test:bot`, `test:memory`, `test:reach`, `test:artifact`, `test:skills`; all
  offline). Client/server boundary changes also need `pnpm build`, because TypeScript does not
  validate Next.js directives. `pnpm knip` lists files, exports and dependencies nothing uses any
  more: delete them rather than keep them behind a guard.
- Schema changes: `pnpm db:generate` (applied at boot) and `pnpm db:migrate` for the current DB.
  Never `drizzle-kit push`. The generated migration is committed with the change, or a fresh clone
  boots against the wrong schema.
- Prompt or tool-description changes: read the assembled result, not just the file. UI changes: run
  the app and look. Judge bot behaviour by counting stored turns and tool calls, not by feel.
- Comments are English, present tense and short. They explain what the code cannot: an invariant, an
  external constraint, the one-line why behind a surprising choice. No history, no narrative.
- Model-facing text (prompts, tool descriptions, `.describe()`) is English and imperative.
- A change the user would notice — a screen, a setting, what a call or a bot can do — updates
  `guide/` in the same commit.
- A new file you created goes in the commit with the rest of your change, which is why anything
  private is named `*.local.*` before it is written, not after. A stray shell redirect at the repo
  root is not one of them.
- **Keep these files true** — this one and `.claude/rules/*.md`. When a change makes a line wrong, fix
  it in the same commit, in the one file that owns it; when it settles something new and
  non-obvious, add it there. Delete what the code no longer does — a stale rule is followed as
  confidently as a live one — and when you add a line, look for one the code now answers. A rule
  states what holds and how to act on it: never history, and never state (uncommitted, unverified,
  in progress), which a day later lies.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
