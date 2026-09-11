# Contributing

## Run it

```bash
git clone https://github.com/cgoinglove/thursday.git
cd thursday
pnpm install
pnpm dev       # first run also fetches the browser bots drive, in the background
```

There is no `.env` to fill in. Keys are entered in the app, on the first screen.
Node 22.18+ and pnpm 10+.

Useful:

| | |
|---|---|
| `pnpm dev` | the app, with hot reload — on 3000, or the next free port |
| `pnpm typecheck` / `pnpm lint` | what CI runs |
| `pnpm reset` | wipe local data (calls, jobs, memory) and optionally the build |
| `pnpm build` && `pnpm start` | the production server, as `npx thursday` runs it |
| `pnpm pack:check` | build the tree npm would publish, into `dist/` |

## Before you open a pull request

- **Read [CLAUDE.md](CLAUDE.md) first.** It is not a style guide; it is where
  each kind of code lives and why. A change that lands in the wrong folder is
  the most common reason a review goes long.
- `pnpm typecheck` and `pnpm lint` both pass.
- **Changed a screen? Run the app and look at it.** Screenshots in the PR help.
- **Changed a prompt or a tool description?** Read the assembled prompt, not the
  diff — the file is a fragment, the prompt is what the model gets.
- **Changed the schema?** `pnpm db:generate`, and commit the migration. Never
  `db:push`.
- One change per pull request. A refactor bundled with a fix is two reviews
  wearing one hat.

## What is worth working on

Open an issue before a large change — the architecture is opinionated, and it is
cheaper to disagree about a paragraph than about a diff. Small fixes, new skills,
a provider driver, or a bug with a reproduction need no permission at all.

## Commits

Pull requests are squashed on merge, so **the pull request title becomes the commit
message** — and that message decides the next release. Write it as
[conventional commits](https://www.conventionalcommits.org):

| Title | Effect |
|---|---|
| `feat: ring the user when a job needs them` | next minor, under Features |
| `fix: keep the caption from clipping at 780px` | next patch, under Fixes |
| `docs:` · `refactor:` · `perf:` | no release; `perf` and `refactor` still show up |
| `chore:` · `test:` | no release, not in the changelog |
| `feat!:`, or `BREAKING CHANGE:` in the body | next major |

A title that fits none of these releases nothing — fine for a typo, wrong for a
feature. Commits inside the branch can say anything.
