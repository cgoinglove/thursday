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

- **A running app's database is someone's real data.** A dev server started on it resumes the jobs
  that were parked, and a copy swapped in under it loses whatever is set in the app meanwhile.
  Check on a server of your own over an empty `THURSDAY_HOME`, or attach read-only to the one
  already running.
- **A port is not proof.** Before attaching, find the `next dev` whose cwd is this repository
  (`lsof -a -p <pid> -d cwd`).
- **Next refuses a second dev server in one folder.** To check a function, call the app's modules
  from an `npx tsx` script inside the repository named `*.local.mts` (bare imports resolve there)
  and delete it after. When a dev server already holds the folder, build and `next start` on
  another port over an empty `THURSDAY_HOME`; with none, `THURSDAY_HOME=<scratch>
  THURSDAY_SKIP_BROWSER=1 pnpm exec next dev -p <port>`, and check that the log says
  `data <scratch>`.
- **A scratch copy's config holds the keys in plain text.** Stop its server and delete the copy
  when done.
- **Screens are checked read-only.** Attach Playwright and do not open threads: opening one marks
  it seen, which is a write. Fake a state in `context.route` — take the JSON with `route.fetch()`,
  change it, answer with `route.fulfill` — and hold a loading or skeleton state with a route that
  never answers.
- **After migrations are rewritten, an old database copy refuses to boot.** Start over an empty
  `THURSDAY_HOME` so it makes a fresh one, then `ATTACH` the old file and copy the `config` and
  `bot` rows across.
- **A dev server hot-reloads code only.** A migration or an `instrumentation` change needs a restart;
  say so after adding a table.
- **A call needs a browser and a microphone**, so placing one is the person's.
