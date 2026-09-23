# thursday

A local-first voice agent. GPT-Live 1 ("Thursday") holds a spoken call; a separate Responses backend
runs the call's tools, and alone answers a call in writing or from a phone. Anything that takes time
goes to text-model bots that run in the background with a shell, a browser and skills. Jobs run on
the server and outlive the call; the screen is a projection of server state.

This is a public MIT repository (`github.com/cgoinglove/thursday`, published to npm as
`thursday-agent`). What is committed here is read by strangers and shipped to their machines.

# Rules

- **English in the tree.** Code, comments, prompts, strings and commit messages are English.
  `README.ko.md` is the one translated file.
- **Nothing about one user goes into the tree.** A user's words, names, accounts, habits and rules for
  a situation are their data — memory, Settings, a `*.local.*` file — never code, prompt text, a test
  fixture or a word list.
- **Anything private is named `*.local.*`.** `.gitignore` keeps that shape out of commits. Never
  `git add -f` one.
- **No heuristic does the model's job.** No phrase matching, per-language word lists or timers that
  guess intent.
- **The user's data is not clutter.** The database, `DATA_DIR/.sign-ins` and `.ai-workspace/` are
  never deleted to tidy up.
- **A number that tunes behaviour is a `config.ts` constant** whose comment says what moving it does;
  a number that is the drawing (a radius, an easing, a timeout the other end also knows) stays
  where it is drawn.

# The two roots

`config.ts` has `APP_DIR` (build, migrations, bundled skills) and `DATA_DIR` (database, workspace,
installed skills, kept sign-ins). Both default to the checkout and move with `THURSDAY_APP_DIR` /
`THURSDAY_HOME`; `npx thursday-agent` points them at the package and `~/.thursday`. The app never
writes into `APP_DIR` at run time.

# Running the app

A running app's database is someone's real data. Boot writes to it: it parks running threads, closes
open calls, starts routines that are due and connects to the phone. Never start a server on it. To
look at the app, serve it on an empty data folder, always bound to loopback:

```
THURSDAY_HOME=$(mktemp -d) THURSDAY_SKIP_BROWSER=1 pnpm exec next dev -H 127.0.0.1 -p <port>
```

That copy still loads `.env`, so a bot on it calls real providers with real keys. When a `next dev`
already runs in this checkout, a second one is refused; never kill it, and serve the build instead:
`pnpm build && THURSDAY_SKIP_BROWSER=1 pnpm start --home "$(mktemp -d)" --port <n> --no-open`.
The running app is someone's: use it only for what writes nothing — opening a thread, or a file
that names one, marks it seen.

A script that calls the app's code is a `*.local.mts` in the repository, run with `npx tsx` and
deleted after. It sets `THURSDAY_HOME` to an empty folder before it loads app code with
`await import()`: a static import runs first, and `database/db.ts` then opens the real database.

# Layout

```
features/<name>/     One domain: <name>.schema.ts (zod), <name>.query.ts (the only drizzle access),
                     <name>.action.ts (server actions), components/ (its screens).
features/ai/         What the model sees: prompts, tools, which model runs.
app/                 Pages, and API routes that hand a domain's query to serverRoute.
components/ui/       Domain-agnostic UI (shadcn and the app's own).
lib/                 Domain-agnostic code: protocol/, live/ (the call seam), sandbox, utils.
database/            db.ts (one client), tables.ts (all tables), migrations/ (pnpm db:generate).
config.ts            Paths, limits and tuning numbers. Not secrets.
bin/                 The `thursday` CLI. Plain .mjs, runs before anything is built.
scripts/             dev, reset, pack (the npm tree), and the test suites (*.test.mts).
guide/               How the app works, for the person using it; Thursday reads it
                     (features/ai/guide.ts).
skills/              Skills shipped with the app, read-only; every bot can load them.
docs/                how-it-works.md, and the images the READMEs show.
```

# Checks

- `pnpm typecheck`, `pnpm lint`, and the suite for the area changed (`pnpm test:live`, `test:bot`,
  `test:memory`, `test:reach`, `test:artifact`, `test:skills`; all offline). A client/server boundary
  change also needs `pnpm build`.
- Schema change: `pnpm db:generate`, and commit the migration with it. Never `drizzle-kit push`. A
  running server applies it only after a restart; say so.
- A change the user would notice updates `guide/` in the same commit.
- `pnpm lint` also runs `scripts/maps.mts`, which fails on a map over its size, a path glob that
  matches nothing, or a named file that no longer exists.

# Maps

Each area has a map in `.claude/rules/`: what it is for, the files to open first, and the few rules
that hold there. Claude Code loads one when it reads a matching file; anything else reads it by hand:

| When you change … | Read |
|---|---|
| A call, spoken, in writing or from a phone: `features/thursday/` logic, `features/reach/`, `lib/live/`, the call prompts | `.claude/rules/call.md` |
| The call screen: her face, the room and its threads, bots' marks, finished cards, the intro | `.claude/rules/screen.md` |
| Shared UI, colours, keys or Settings: `components/`, `hooks/`, `app/globals.css`, `features/settings/` | `.claude/rules/ui.md` |
| How a screen looks: the maintainer's picks | `.claude/rules/taste.md` |
| How jobs run: bots, threads, the room, routines, `bot.prompt.ts` | `.claude/rules/jobs.md` |
| A bot's shell, browser, workspace or borrowed sign-ins | `.claude/rules/workbench.md` |
| Shipped skills, seed bots or finished work: `skills/`, `features/skills/`, `features/artifact/` | `.claude/rules/skills.md` |
| Prompts, tools or memory: `features/ai/prompts/`, `features/ai/tools/`, `load-tools.ts`, `features/memory/` | `.claude/rules/model.md` |
| Models, keys, the ChatGPT sign-in, media models or MCP | `.claude/rules/providers.md` |
| Reads, writes, events, the database or what may reach the app | `.claude/rules/data.md` |
| Boot, `config.ts`, the CLI, packaging, CI or a release | `.claude/rules/ship.md` |
| The READMEs, `docs/how-it-works.md`, `SECURITY.md`, `CONTRIBUTING.md` or `guide/` | `.claude/rules/docs.md` |

Keeping them true:
- A change that makes a line of a map wrong rewrites that line in the same commit and moves the
  map's `checked:` date; a line is replaced, never followed by a correction.
- A new entry file gets a line under its map's "Start here"; a new area gets a map of its own.
- A rule or a pick in `taste.md` earns its line only when the same mistake comes back or the
  maintainer asks for it, and an agent proposes it at the end of its report rather than adding it.
- When a new model arrives, what it no longer needs is deleted: `/claude-api prompt-audit`, and
  `node scripts/maps.mts --stale` for the maps whose area changed most since they were checked.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
