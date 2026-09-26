---
checked: 2026-09-26
paths:
  - "skills/**"
  - "seed-skills/**"
  - "features/skills/**"
  - "features/artifact/**"
  - "features/bot/{bot.seed,seed-bots}.ts"
  - "features/ai/tools/{skills,deck}.tool.ts"
  - "app/api/{skills,artifact,file}/**"
  - "app/artifact/**"
  - "scripts/{skill-files,page-edits,deck,sheet,artifact-paths}.test.mts"
---

# Skills and finished work

Every bot makes pages, canvases, decks, picture books and reports with the same shipped skills, and
the user opens what they made in the app and edits a page, a deck or a canvas there.

## Start here
- `skills/README.md` — which folders are not skills, the script paths promised, outside copies.
- `features/skills/skills.discover.ts` — where skills are found, which one holds a name, a ready-made bot's kit, the old copies left unlisted.
- `features/ai/tools/skills.tool.ts` — `load_skill`: a skill's instructions and files.
- `skills/artifact/SKILL.md` — what the user keeps or uses (document, canvas, picture book, deck, sheet, page, app, chart, diagram) as one skill, its `runtime/` behind it; a sheet is a real .xlsx (`skills/artifact/scripts/spreadsheet.mjs`).
- `skills/artifact/runtime/shell/put.mjs` — how a bot writes into a page a skill made; the revision saves check.
- `features/ai/tools/deck.tool.ts` — `make_deck`: typed slides that `skills/artifact/runtime/deck` draws.
- `features/bot/bot.seed.ts` — the seed bots' roles, and what a role may name.
- `features/artifact/artifact.query.ts` — finished work, listed from the bots' folders alone.
- `app/api/file/[...path]/route.ts` — a workspace file served; a page runs on its own origin.

## How it fits
A job's shell names the bot's artifacts folder and the shipped skills (`botShellEnv` in
`features/workspace/workspace.ts`); `document.mjs`, `canvas.mjs` and `book.mjs` write there by
default, and `make_deck` runs `deck.mjs` itself. All dress their one HTML file in the artifact
skill's `runtime/shell`, which `load_skill` never lists (`PATHS.skills.runtime`). The app lists
finished work from the folders, serves it through `app/api/file`, and frames a page in `FileFrame`
(`features/workspace/components/file-view.tsx`): a reader's edits go to `savePage`, a write while
it shows goes to the page as `changed`. A seed's own skills are read in place from
`seed-skills/<name>/`; older copies in bots' folders stay, unlisted (`seed-skills/retired.json`).

## What breaks
- A job's browser may be a window on the user's screen: a role or `SKILL.md` that sends a bot to
  the browser to look at what it made opens it in front of the user, where a skill's `shots` over
  `render.mjs --apart` shows it to the bot alone.
- The suites mock `pictures.ts`, stub `shots` and frame no page, so a contract between `skills/`
  and the app changed on one side only breaks unseen: `render.mjs`'s options and
  `features/reach/pictures.ts`; the last line of `deck.mjs shots` and `deck.tool.ts`; the shell's
  generator meta, `?face` and frame messages and `app/artifact`, `file-thumb.tsx`, `FileFrame`;
  `spreadsheet.mjs sync` (its exit 3) and `savePage`.
- A seed's text is copied into its bot when the bot is made, so a role change never reaches a bot
  already installed; what every bot must get lives in a skill or the base prompt.
- Two skills for one ask split the bots' choice; a new capability that extends an existing skill,
  or `make_deck`, does not.
- The call reads a `SKILL.md` description's first sentence alone (`skillLines` in
  `features/ai/prompts/prompt-helper.ts`): a description that does not say there what the skill
  does is not understood.

## Check
`pnpm test:skills` (`load_skill`'s file list, `put` against a reader's save, `make_deck`) and
`pnpm test:artifact` (which finished file opens, viewer URLs). A kit script run by hand from an
empty folder outside the checkout and the workspace, with `THURSDAY_ARTIFACTS` unset, writes
under `./artifacts`: `node <repo>/skills/artifact/scripts/document.mjs put demo <repo>/skills/artifact/templates/document/memo.md`.
