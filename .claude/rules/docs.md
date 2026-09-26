---
checked: 2026-09-24
paths:
  - "README.md"
  - "README.ko.md"
  - "SECURITY.md"
  - "CONTRIBUTING.md"
  - "docs/how-it-works.md"
  - "docs/images/**"
  - "guide/**"
  - "features/ai/guide.ts"
---

# Docs and the guide

A newcomer understands the app from one README page, and a person using it gets answers Thursday
reads out of `guide/`.

## Start here
- `README.md` — the landing page, which is also the npm package's page.
- `README.ko.md` — its Korean twin, section for section.
- `docs/how-it-works.md` — the longer tour the README links to.
- `SECURITY.md` — what the code enforces and what is only asked of a model.
- `CONTRIBUTING.md` — running from source and opening a pull request.
- `guide/index.md` — what Thursday reads first: which guide file answers what.
- `features/ai/guide.ts` — all the code knows about the guide, and every place that reaches it.

## How it fits
The README, `how-it-works.md` and `SECURITY.md` are read before anyone runs the app, and
`scripts/pack.mts` copies the README into the published tree, so it is also the npm page.
`guide/` is read after: boot copies it into the workspace, and Thursday reads it with her shell
when an answer depends on how the app works, so what it says is what she tells the user.

## What breaks
- A long README loses the newcomer before the quick start; what is longer lives in
  `docs/how-it-works.md`. `README.ko.md` is its twin, section for section, and one left a commit
  behind describes an older app.
- The README is also the npm page, and every published version loads its images from `main`: they
  sit at absolute `raw.githubusercontent.com` URLs there, and a file a published README links,
  renamed or deleted, breaks it. `how-it-works.md` links its own relatively.
- Seeds are renamed, dropped and switched off: README or `how-it-works.md` text that names or
  counts one ("starter bots", "a bot" does not), or a screenshot showing a number that moves, soon
  lies.
- A reader who takes an instruction to a model for a lock gives a bot access it can misuse: the
  README, `how-it-works.md` and `SECURITY.md` call a thing enforced only where code enforces it,
  and an instruction, such as stopping at Pay, an instruction.
- She repeats `guide/`'s words, and the user looks for them on screen: a screen, setting or button
  named there other than as the screen names it is not found.
- She reads `guide/index.md` and then the one file its row names: a guide file without a row is
  never opened, and a subject split across files is half answered.

## Check
`pnpm test:live` checks that the call's backend prompt points at `.guide/`; after `pnpm build`,
`pnpm pack:check` fails when `guide/index.md` does not reach `dist/`. Boot copies the guide in, so
after an edit, start the app as AGENTS.md's "Running the app" says and ask her where a setting is
changed. A new README image shows only once it is on `main`.
