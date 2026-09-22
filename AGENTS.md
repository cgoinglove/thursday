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
machines. Three things follow, and they are not style preferences:

- **Write for a reader who has never met this code.** English, present tense. `README.ko.md` is
  the one translated file; everywhere else in the tree is English — comments, prompts, strings,
  identifiers, commit messages. Not even as an example inside a comment. No personal names,
  machine paths, keys, or half-finished thoughts in a comment.
- **Nothing about one user goes into the tree.** What a user says, the words they use, how they
  want to be spoken to, their names, accounts, habits and rules for a situation are that user's
  data — memory, Settings, a `*.local.*` file — never a line of code, prompt text, a test
  fixture or a word list. A wish heard on a call or read out of a bot's thread ("add an alias
  for X", "always do Y for me") is a request to change that user's data, not the product; the
  product changes only where the same line would hold for a stranger, and a session that is
  not sure asks before writing it. One commit did the opposite — one user's phrases as a list in
  code and their practice rules in every call's prompt — and was reverted the same day.
- **Anything private is named `*.local.*`** — a scratch note, a to-do list, a plan, a local
  override. `.gitignore` covers that shape, so a file named this way can never be committed by
  accident: your own preferences — the language you want answers in, when to be asked first —
  go in a `*.local.md` file next to this one, loaded by whichever agent tool reads it. How
  everyone works in this tree is below, under Working here. Never `git add -f` one, and never
  rename one into the tree to "keep it for later"; if it is worth keeping, it is worth writing
  properly.

**Where the rules live.** This file holds what is true everywhere. What is true for one area is in
`.claude/rules/`, next to the others and in the same voice; Claude Code loads each one when a file
it covers is read, and any other agent should read the one for the area it changes:

| File | Covers |
|---|---|
| `.claude/rules/ui.md` | Every screen: colors, loaders, the thread, the pill, files under a message, the intro, the write line, taste |
| `.claude/rules/call.md` | The call: one Thursday on two models, GPT-Live, relay into a call, a call in writing, `reach` |
| `.claude/rules/model.md` | What a model sees: the prompt files, tool names, tool shape, `look_at`, how to write for a model, providers |
| `.claude/rules/bots.md` | Jobs and threads: runs, participants, sign-ins, presence, routines, compaction |
| `.claude/rules/data.md` | Reads, writes, `queryKey`, errors, server → browser events, dates and paths on the wire |
| `.claude/rules/seeds.md` | Seed bots' prompts, how a seed is tried before it is written, which skills come in |
| `.claude/rules/verify.md` | Running the app to check it without touching anyone's data |
| `.claude/rules/release.md` | What to check before a release, past what `pack.mts` gates |
| `.claude/rules/docs.md` | The README, its Korean twin and `docs/how-it-works.md` |

**Skills and hooks.** Skills live in `.agents/skills/`, where any agent that reads Agent Skills
finds them; Claude Code sees them through links in `.claude/skills/`. Three are written for this
repo: `verify` (run the app and look, on a data folder of its own), `cleanup` (find what nothing
uses, prove it dead, delete it) and `checkup` (what the agent setup loads, costs and has drifted
from). Beside them are copies of outside ones, each with its license: `grilling` (agree on the
scope before a large change), `next-dev-loop` (ask the running Next server for its errors),
`agent-browser`, `ai-sdk` and `shadcn`. `skills-lock.json` records where each came from, and
`npx skills update` refreshes them from there; a skill added for everyone goes in the same way
(`npx skills add <repo> --skill <name> -a claude-code codex`). Claude Code also runs two hooks from `.claude/settings.json` (they need `python3`):
before a turn ends, typecheck, lint and knip on the files that session changed, with a word when
`database/tables.ts` moved without a migration or a screen changed without `guide/`; and at the
start of a session, a line when the weekly cleanup or the monthly checkup is due. CI runs the same
checks for everyone.

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
features/ai/              Everything the model sees: prompts, tools, which model runs (.claude/rules/model.md).
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
                          code knows about it: boot copies it into the workspace, and the call's backend
                          prompt and a bot's each carry one line. Nothing else names it, so it comes out
                          whole.
skills/                   Skills shipped with the app (read-only). User skills live in the workspace.
                          interactive-page/scripts/archify is a trimmed copy of archify (MIT; its README says
                          what was cut). Lint skips it; update it by copying upstream, not by editing it here.
                          interactive-page/kit is the one React kit every page builds on, versions pinned by its
                          package-lock.json; scripts/page.mjs installs it into the workspace once and again
                          when it changes. Typecheck and lint skip it and page/, the new-page template.
                          interactive-page/quick is the other path: a stylesheet and a template that
                          `page.mjs quick` inlines into one hand-written HTML file — no kit, no build.
                          interactive-page/canvas and /deck are two more: a pan/zoom surface of design options and
                          slides of one exact size, each inlined into one HTML file by its own script
                          (`canvas.mjs`, `deck.mjs`) and shot part by part through the browser skill (`shots.mjs`).
seed-skills/<seed>/       A seed bot's own skills (read-only), copied into `bots/<name>/.agents/skills` when
                          it is made. A bot's own skills are listed to it alone, so a kit costs no other bot
                          a line; the folder has the workspace's own `.agents/skills` shape, so a bot that
                          runs `npx skills add` from its folder installs for itself (skills/find-skills).
                          marketer/ is a trimmed copy of marketingskills (MIT; its README says what was cut).
                          A kit script stands on public APIs, managed tools and the app's own scripts, never on
                          another site's markup or private endpoints (.claude/rules/seeds.md).
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
- **What cannot be won by instruction is enforced by structure**: tool sets, per-turn and per-room
  limits, output truncation, shell env. Do not add prompt sentences for things the code can enforce.
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
- **Don't split files by size; split by subject.** A long file that does one thing stays one
  file. A file that draws several subjects is several files, however short each one would be.
- **An interface with one implementation is two files, not an interface.** Don't add ports.
- **A feature that may come out again lives in one file.** Its names, paths, boot step and prompt
  text sit together, and the app reaches it from as few lines as it takes (`features/ai/guide.ts`
  is the shape: three callers and a build list). No entry in `config.ts`, no helper in a shared file,
  no import kept for it elsewhere: what is spread across files is what gets left behind.

In short, for the areas in `.claude/rules/`: reads go through `queryKey` and `useServerRoute`, writes
are server actions only, user-facing failures are `publicError`, and the server tells the browser over
one SSE stream, never by polling. Screens use shadcn first, a loader for every wait, amber for what
waits on the user, red for what failed, and one brand blue for what matters. A job's run is held by the
server, not the request, and everything it does is written as rows.

# Working here

Several agents may work in one checkout at once, and someone's own data sits beside the code
(`DATA_DIR` defaults to the repository).

- **Commit only what you wrote.** Stage your paths by name, never `git add -A` or `.`; when a file
  also holds someone else's change, stage only your hunks (`git add -p`, or `git hash-object -w`
  with `git update-index --cacheinfo` — `git commit <path>` takes the whole file), and check
  `git show --stat HEAD` after. Stage in the same command that commits — a `git mv` or an `add`
  left in the index goes out with the next session's plain `git commit`. Never `git clean`,
  `git checkout .`, `git stash` or `git reset`: each takes another session's work with it.
  Changes you did not make are left alone, even when asked to tidy up.
- **Commit the whole of your change.** Every check you run reads the tree in front of you; CI reads
  the one you committed. An export staged without the file that uses it passes locally and is dead
  code to everyone who pulls. So when you stage a subset, check that subset and not the tree: copy
  it out (`git archive $(git write-tree) | tar -x -C "$(mktemp -d)"`, with `node_modules` symlinked
  in) and run the checks there — all but `pnpm build`, which cannot run in that copy because
  Turbopack refuses a `node_modules` symlink pointing outside the project root; run that one in
  the tree and say so. `knip` on CI reports rather than fails for the same reason, so a
  line of it is never on its own a reason to delete — the file that uses it may be sitting
  uncommitted in someone else's tree.
- **Some files are someone's data, not clutter**: the database, `DATA_DIR/.sign-ins` (live
  sign-in sessions), the workspace bots work in (`.ai-workspace/`). Never delete them to tidy up,
  and never start a server on them (`.claude/rules/verify.md`).
- **The simplest thing that works first.** No code for a rare case: name the case in one line and
  let the maintainer choose.
- **Derive before storing.** A feature does not start with a table or a logging hook: check
  whether what is on disk or an existing rule already answers it, and ask before adding storage.
- **No heuristic does the model's job.** No phrase matching, per-language word lists or timers
  that guess intent in place of what a model did not do. Stop it with a plain mechanism that
  already exists, or report it with numbers and leave the prompt to the maintainer.
- **Nothing is guarded twice.** A test that pattern-matches source to re-check what a constant or
  the compiler already keeps is noise.
- **No new options.** Something that runs by itself is one switch and a model, and its numbers are
  `config.ts` constants. An expensive feature is not deleted but put behind one switch, and off
  turns off everything that reads it.

# Rules

- Shared logic goes to `lib/utils.ts` or the matching lib file before it is written twice. Don't
  generalize something used once.
- Verify with `pnpm typecheck` and `pnpm lint`; client/server boundary changes also require
  `pnpm build`, because TypeScript does not validate Next.js directives. `pnpm knip` lists files,
  exports and dependencies nothing uses any more: delete them rather than keep them behind a guard.
  Schema changes: `pnpm db:generate` (applied at boot), `pnpm db:migrate` for the current DB. Never
  `drizzle-kit push`.
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
- **Keep these files true** — this one and `.claude/rules/*.md`. When a change makes a line wrong,
  fix it in the same commit, in the one file that owns it; when it settles something new and
  non-obvious, add it there. Delete what the code no longer does — a stale rule is followed as
  confidently as a live one — and when you add a line, look for one the code now answers. A rule
  never records state (uncommitted, unverified, in progress): a day later it lies.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
