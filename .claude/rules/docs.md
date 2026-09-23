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

## Rules
- `README.md` stays a landing page and anything longer goes to `docs/how-it-works.md`;
  `README.ko.md` changes in the same commit, section for section — a long README loses the
  newcomer before the quick start, and a twin left behind describes an older app.
- README images stay at absolute `raw.githubusercontent.com` URLs on `main`, and a file the
  published README links is never renamed or deleted; `how-it-works.md` links its own relatively —
  the README is also the npm page, and every published version loads its images from `main`.
- The text of the README and `how-it-works.md` names no seed bot and counts none ("starter bots",
  "a bot"), and a screenshot shows no number that moves — seeds are renamed, dropped and switched
  off, and the landing page then lies.
- The README, `how-it-works.md` and `SECURITY.md` tell one story about protection: a thing is
  called enforced only where code enforces it, and an instruction to a model, such as stopping at
  Pay, is called one — a reader who takes an instruction for a lock gives a bot access it can
  misuse.
- `guide/` writes every screen, setting and button name exactly as the screen does — she repeats
  the words, and the user looks for them on screen.
- Every guide file has a row in `guide/index.md`'s table, and a subject lives in the one file its
  row names — she reads the index and then one file, so a file without a row is never opened and a
  split subject is half answered.

## Check
`pnpm test:live` checks that the call's backend prompt points at `.guide/`; after `pnpm build`,
`pnpm pack:check` fails when `guide/index.md` does not reach `dist/`. Boot copies the guide in, so
after an edit, start the app as AGENTS.md's "Running the app" says and ask her where a setting is
changed. A new README image shows only once it is on `main`.
