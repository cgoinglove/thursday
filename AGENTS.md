# thursday

A local-first voice agent. GPT-Live 1 ("Thursday") holds the call; a separate Responses backend runs
the call's tools. Anything that takes time goes to text-model bots that run in the background with a
shell, a browser and skills. Jobs run on the server and outlive the call; the screen is a projection
of server state.

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

That copy still loads `.env`, so a bot on it calls real providers with real keys.

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
skills/, seed-skills/  Skills shipped with the app and each seed bot's kit.
docs/                how-it-works.md, and the images the READMEs show.
```

# Checks

- `pnpm typecheck`, `pnpm lint`, and the suite for the area changed (`pnpm test:live`, `test:bot`,
  `test:memory`, `test:reach`, `test:artifact`, `test:skills`; all offline). A client/server boundary
  change also needs `pnpm build`.
- Schema change: `pnpm db:generate`, and commit the migration with it. Never `drizzle-kit push`.
- A change the user would notice updates `guide/` in the same commit.

# Commits

Several agents may work in one checkout at once.

- Stage your own paths by name; never `git add -A` or `.`. Never `git clean`, `git checkout .`,
  `git stash` or `git reset`: each takes another session's work with it.
- The subject is `type(scope): subject`, lowercase, no full stop. release-please turns it into the
  changelog line and the next version, so a fix is `fix`, not `feat`. `CHANGELOG.md` is never edited
  by hand.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
