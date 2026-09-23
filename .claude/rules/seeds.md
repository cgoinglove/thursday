---
paths:
  - "features/bot/bot.seed.ts"
  - "features/bot/seed-bots.ts"
  - "features/skills/**"
  - "features/ai/tools/skills.tool.ts"
  - "skills/**"
  - "scripts/skill-files.test.mts"
---

# Seed bots and skills

The head comment of `bot.seed.ts` comes first: what a role holds and never names. This adds what it
does not say. A `SKILL.md` is model-facing text, so `model.md` › Writing for a model applies to it.

## What ships

- `skills/` — skills shipped with the app, read-only; a user's own live in the workspace.
  **Every skill is every bot's.** A capability is a shipped skill, never one seed's: what only one
  bot could load is gone when that bot is, never reaches a bot made before an update, and is not in
  Settings › Skills to switch off. A seed differs by its role. `skills/README.md` says where outside
  work came from, and which script paths released skills call, which therefore never move.
  - By role: `browser` (the web) and `computer` (this Mac) act; `media-digest` reads a video, a
    podcast, an article or a PDF; `data-report`, `daily-brief` and `travel` find out, each with
    scripts on sources that need no key; `interactive-page` (a document), `design` (a canvas),
    `picture-book` and the `make_deck` tool make what the app shows; the six marketing skills
    (`product-marketing`, `copywriting`, `emails`, `launch`, `social`, `seo-audit`) are a trimmed
    copy of marketingskills (MIT), updated by copying upstream and repeating the changes the README
    lists; `find-skills` and `skill-creator` are about skills.
  - `interactive-page/` builds a page to read: `quick/` is a stylesheet, a script and ready
    documents that `page.mjs quick` inlines into one hand-written HTML file, with no install and no
    build. A page someone would use rather than read — a calculator, a tool with state — is not
    shipped: writing React and running a build is where a cheap model has the most to get wrong. Charts go
    in by `scripts/chart.mjs`; `scripts/archify` is a trimmed copy of archify (MIT, its README says
    what was cut): update it by copying upstream, never by editing it here.
  - `design/` (a pan/zoom canvas of boards, each at its own size) is a skill of its own because a
    user asks for it by name. It is inlined into one HTML file by its own script (`canvas.mjs`),
    starts from ready boards (`design/boards`) and is shot through the browser skill's renderer.
  - `deck/` is not a skill (no `SKILL.md`): it is what `make_deck` writes (`features/ai/tools/
    deck.tool`). A deck is typed because how a slide looks — its sizes, a heading that hops, words
    that run off it — is where a cheap model went wrong, so the model fills a layout's fields and
    this folder draws them: the file holds the deck as JSON, and its own script draws every slide
    from it and shrinks the type of one that does not fit (`deck.js`). An edit in the app changes
    that data and draws the slides again from it, so what a person edits and what a bot writes are
    the same thing. `deck.mjs` writes the deck into the frame as it ships now, every time, so an
    update reaches decks made before it, and shoots it. The schema's character caps answer to
    `deck.css`: a layout changed there moves them; the editor does not hold to them, so a deck
    handed back after an edit can be refused by the schema until the bot says less.
  - `shell/` is not a skill (no `SKILL.md`): it is what the three scripts (`page.mjs`, `canvas.mjs`,
    `deck.mjs`) put on every file they write, through the module they import (`shell/wear.mjs`) —
    the head a page wears, its buttons and menus, the theme, and the page asking the app that shows
    it to keep its edits — by message to the frame, the one door out of the sandbox the page is
    served in (`data.md`). A kind that edits (the document, the deck, a canvas's notes) takes the
    line that says where keeping stands, Reload and Edit where it has one from the shell
    (`shell.edits`), and says only what changed. A note the user pins on a canvas is marked
    `data-by="user"`, so the bot that gets the canvas reads it as their answer. What a bot writes goes in by `put` (`shell/put.mjs`) between two marks
    the page is made with, so the frame is never written over. The start mark keeps a print of the
    last body put or got, and `put` refuses a page whose body is not that one — edited in the app
    or by hand — until `get` has handed the bot the body as it is now. Every put names a new
    revision in the head, and the app refuses a save that names an older one (`savePage`), so
    neither side undoes the other. A deck is checked by that revision alone: `make_deck` hands it
    back with every deck, and a change that names another is answered with the deck as it stands.
    Each script's `shots` takes its pictures in a headless browser of its own (`render.mjs
    --apart`), never in the job's, which may be a window on the user's screen. Its classes and
    custom properties are prefixed `sh-`, since a bot's own stylesheet shares the page, and a kind's
    defaults for what a bot writes weigh nothing (`:where`), so what the bot writes wins. It marks
    the page near the top (`<meta name="generator" content="Thursday">`); the app's own tab looks
    for that and leaves its bar off, since the page carries its name and Export itself.
  - Lint skips `archify`.
- A bot's own folder has the workspace's `.agents/skills` shape, so `npx skills add` run from it
  installs for that bot alone. A copy of a shipped skill kept there is never opened: the shipped one
  holds the name.

## Seed prompts

- **A seed names no skill, no tool procedure, and nothing the base prompt already says.** The base
  prompt lists every skill with its description, a bundled skill can be switched off, and how to
  sign in, pay or ask a question is the tool's and the browser skill's to say. A role holds what only
  it knows: what is this bot's, what it ends as, the judgement only it makes, what it keeps in
  memory. The exceptions are a structural dependency (`requires`) and the skill or tool that is the
  bot's whole trade — the browser for a bot that reads pages for a living, `design`, the page skill
  and `make_deck` for the bot that makes what is looked at — named from `config.ts`
  (`BROWSER_SKILL`, `DESIGN_SKILL`, `PAGE_SKILL`) or `TOOL_NAMES`, never spelled in the prose.
- **A bot's folder is "your own folder"** in a role; a `bots/<name>/…` path breaks when it is renamed.
- **No outside conventions in a seed** — an external pack's file paths or a new place to keep things.
  A skill that needs such a file handles it.
- **A seed is read on first install only.** A change to its text carries no upgrade for rows already
  installed.
- Jarvis's empty role (`systemPrompt: ""`) is deliberate.
- **No seed coordinates the others.** A bot that needs help asks another bot for it.
- **Every seed installs by default and shows in the intro's opening loop**, so a new seed is a
  visible change.

## Skill scripts

- **What a job repeats is a skill's script, not a paragraph.** Reading a web app through snapshots costs
  tens of thousands of characters a look; a script that fetches the same rows costs a few hundred.
- **A skill's script stands on a public API, a managed tool or the app's own scripts** — never on another
  site's markup, its private endpoints or a pinned client version, which break quietly the day that
  site changes. What a script cannot get that way is read once through the browser skill or put on
  the user's screen. It fails loudly, never with an empty result.
- It drives a browser only through `$THURSDAY_SKILLS/browser/scripts/session.mjs`, which opens a
  headless one when none is open, and takes `render`, `sheet`, `webimage` and `chart` from the shipped
  skills rather than keeping a copy. It finds shared things through `THURSDAY_SKILLS` and writes
  output under `THURSDAY_ARTIFACTS`. `render` serves on port 0, so concurrent jobs never share one.
- **What a skill makes, it shoots itself** (`shots`, over `render --apart`), and its answer names
  the pictures. A bot is never sent to the browser to look at its own work: the browser skill is for
  the web.
- **A skill's script stands alone past that.** The lines that walk up to the workspace folder are
  repeated in each skill on purpose: a skill copied into a bot's or the user's folder to change it
  still runs, and a shared file is one more thing that has to be there. Leave the copies.
- **A skill's script is run before it is written.** Do the job by hand in a shell and time the shortest
  sequence of commands; the traps show there, not in docs. A slow bot is usually a turn per command,
  not the model: have it batch commands into one bash call. An instruction without a count runs
  away; pin it ("one and only one"). A screen whose state no URL can set takes a snapshot between
  clicks.

## Skills

- **A new capability extends an existing skill first** — `interactive-page` for a page, `design` for a
  board; a slide is a layout of `make_deck` — or a few lines of its description. A good outside skill
  may come in whole, engine and all.
- **A skill's name is the first thing a bot matches a job against.** A kind of result a user asks for
  by name (a design) is a skill of its own, or a tool when its look is the app's to get right (a
  deck); a kind nobody names (a chart, a diagram) stays a method inside one. Two ways to make one
  thing each say in their description which ask is theirs.
- **A description says what, then when** ("Makes X. Use it when …").
- **A `SKILL.md` holds what the model needs to start and does not already know**; procedures go in
  `references/`, and what it points at sits directly in `references/` and `scripts/`. A bundled
  engine or component kit goes a folder deeper, since `load_skill` lists files shallowest first, up
  to `SKILL_FILES_LISTED`.
- **A skill's script takes a path as well as a name.** A name resolves inside the running bot's own
  artifacts folder, and work another bot made lives in that bot's.
- `platforms:` in the frontmatter limits a skill to one OS (`computer`). Shipped skills win a name,
  then the bot's own, then the user's; a skill switched off still holds its name.
- **An outside skill is chosen by its repository and GitHub stars**, not its install count on
  skills.sh.
