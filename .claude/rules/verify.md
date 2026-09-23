---
paths:
  - "scripts/**"
  - "bin/**"
  - "config.ts"
  - "instrumentation-node.ts"
  - "database/**"
  - "**/*.local.mts"
---

# Running the app to check it

The `verify` skill (`.agents/skills/verify/`) is how a screen is looked at: `serve.sh start|stop`
serves a copy on an empty data folder, and `look.cjs` drives it headless. This file holds what the
skill does not.

- **A running app's database is someone's real data.** Boot writes to it: it parks every running
  thread until someone presses Continue, closes open calls, starts routines that are due and connects
  to their phone. Never start a server on it; check on a server of your own over an empty
  `THURSDAY_HOME`, or attach read-only to the one already running. In a checkout `pnpm start` opens
  that same database (`bin/thursday.mjs`); `pnpm start --home <dir> --port <n> --no-open` does not.
- **A port is not proof.** Before attaching, find the `next dev` whose cwd is this repository
  (`lsof -a -p <pid> -d cwd`).
- **Next refuses a second dev server in one folder.** To check a function, call the app's modules from
  an `npx tsx` script in the repository named `*.local.mts` (bare imports resolve there) and delete
  it after. By hand, a scratch server is `THURSDAY_HOME=<scratch> THURSDAY_SKIP_BROWSER=1 pnpm exec
  next dev -H 127.0.0.1 -p <port>`, and its log says `data <scratch>`. Never without `-H 127.0.0.1`:
  a voice agent with a shell is not a thing to expose.
- **A scratch home is not a keyless one.** Next loads `.env` whatever the data folder is, so a copy
  can call the user's providers for real, and its config holds keys in plain text. A bot on it is
  driven only on purpose; rows seeded only to be looked at are `done` or `cancelled`. Stop the server
  and delete the copy when done.
- **Screens are checked read-only.** Opening a thread, or a file view that names one, marks it seen,
  which is a write. Fake a state in `context.route` — take the JSON with `route.fetch()`, change it,
  answer with `route.fulfill` — and hold a loading state with a route that never answers.
- **After migrations are rewritten, an old database copy refuses to boot.** Start over an empty
  `THURSDAY_HOME` so it makes a fresh one, then `ATTACH` the old file and copy the `config` and `bot`
  rows across.
- **A dev server hot-reloads code only.** A migration or an `instrumentation` change needs a restart;
  say so after adding a table.
- **A call needs a browser and a microphone**, so placing one is the person's.
- **Tests run offline.** The suites are `scripts/*.test.mts`, run by `pnpm test:<name>` with
  `node --import tsx --test`, providers stubbed and `THURSDAY_SKIP_BROWSER` set. A test that would
  call a real provider is a `*.local.mts` script, run on purpose.
- **A stored row shows today's behaviour only if it is recent.** A local database is reset often:
  compare `createdAt` with recent commits before judging the code by a row. How often something was
  used says nothing about whether it is worth keeping.
- **Read a thread by its timeline first** — each part's type, tool and length — then cut out only the
  `seq` you need. A password or key someone typed into a chat is never printed again.
