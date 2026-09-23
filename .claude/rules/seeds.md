---
paths:
  - "features/bot/bot.seed.ts"
  - "features/bot/seed-bots.ts"
  - "features/skills/**"
  - "features/ai/tools/skills.tool.ts"
  - "skills/**"
  - "seed-skills/**"
  - "scripts/skill-files.test.mts"
---

# Seed bots and skills

The head comment of `bot.seed.ts` comes first: what a role holds and never names. This adds what it
does not say. A `SKILL.md` is model-facing text, so `model.md` › Writing for a model applies to it.

## What ships

- `skills/` — skills shipped with the app, read-only; a user's own live in the workspace.
  - `interactive-page/` builds a page. `kit/` is the one React kit every page builds on, versions
    pinned by its `package-lock.json`, which `scripts/page.mjs` installs into the workspace once and
    again when it changes; `page/` is the new-page template; `quick/` is the other path — a
    stylesheet, a script and ready documents that `page.mjs quick` inlines into one hand-written
    HTML file, no kit and no build. `scripts/archify` is a trimmed copy of archify (MIT, its README
    says what was cut): update it by copying upstream, never by editing it here.
  - `design/` (a pan/zoom canvas of boards, each at its own size) and `slides/` (slides of one exact
    size) are skills of their own because a user asks for them by name. Each is inlined into one
    HTML file by its own script (`canvas.mjs`, `deck.mjs`), starts from ready parts
    (`design/boards`, `slides/deck/slides`) and is shot through the browser skill's renderer.
  - `shell/` is not a skill (no `SKILL.md`): it is what those three scripts inline into every file
    they write — the head a page wears, its buttons and menus, the theme. Its classes are prefixed
    `sh-` because a bot's own stylesheet shares the page.
  - Typecheck and lint skip `kit/`, `page/` and `archify`.
- `seed-skills/<seed>/` — a seed bot's own kit, read-only, copied into `bots/<name>/.agents/skills`
  when the bot is made and listed to that bot alone, so a kit costs no other bot a line. The folder
  has the workspace's `.agents/skills` shape, so `npx skills add` run from a bot's folder installs for
  that bot. A kit copied from outside carries its LICENSE and a README saying what was cut
  (`marketer/` is a trimmed copy of marketingskills, MIT).

## Seed prompts

- **A seed names no skill, no tool procedure, and nothing the base prompt already says.** The base
  prompt lists every skill with its description, a bundled skill can be switched off, and how to
  sign in, pay or ask a question is the tool's and the browser skill's to say. A role holds what only
  it knows: what is this bot's, what it ends as, the judgement only it makes, what it keeps in
  memory. The exceptions are a structural dependency (`requires`) and the skill that is the bot's
  whole trade — the browser for a bot that reads pages for a living, `design`, `slides` and the page
  skill for the bot that makes what is looked at — named from `config.ts` (`BROWSER_SKILL`,
  `DESIGN_SKILL`, `SLIDES_SKILL`, `PAGE_SKILL`), never spelled in the prose.
- **A bot's folder is "your own folder"** in a role; a `bots/<name>/…` path breaks when it is renamed.
- **No outside conventions in a seed** — an external pack's file paths or a new place to keep things.
  A skill that needs such a file handles it.
- **A seed is read on first install only.** A change to its text carries no upgrade for rows already
  installed.
- Jarvis's empty role (`systemPrompt: ""`) is deliberate.
- **No seed coordinates the others.** A bot that needs help asks another bot for it.
- **Every seed installs by default and shows in the intro's opening loop**, so a new seed is a
  visible change.

## Kit scripts

- **What a job repeats is a kit script, not a paragraph.** Reading a web app through snapshots costs
  tens of thousands of characters a look; a script that fetches the same rows costs a few hundred.
- **A kit script stands on a public API, a managed tool or the app's own scripts** — never on another
  site's markup, its private endpoints or a pinned client version, which break quietly the day that
  site changes. What a script cannot get that way is read once through the browser skill or put on
  the user's screen. It fails loudly, never with an empty result.
- It drives a browser only through `$THURSDAY_SKILLS/browser/scripts/session.mjs`, which opens a
  headless one when none is open, and takes `render`, `sheet`, `webimage` and `chart` from the shipped
  skills rather than keeping a copy. It finds shared things through `THURSDAY_SKILLS` and writes
  output under `THURSDAY_ARTIFACTS`. `render` serves on port 0, so concurrent jobs never share one.
- **A kit script stands alone past that.** The lines that walk up to the workspace folder are copied
  into each kit on purpose: a kit is copied into a bot's folder, and a shared file is one more thing
  that has to be there. Leave the copies.
- **A seed's script is run before it is written.** Do the job by hand in a shell and time the shortest
  sequence of commands; the traps show there, not in docs. A slow bot is usually a turn per command,
  not the model: have it batch commands into one bash call. An instruction without a count runs
  away; pin it ("one and only one"). A screen whose state no URL can set takes a snapshot between
  clicks.

## Skills

- **A new capability extends an existing skill first** — `interactive-page` for a page, `design` for a
  board, `slides` for a slide — or a few lines of its description. A good outside skill may come in
  whole, engine and all.
- **A skill's name is the first thing a bot matches a job against.** A kind of result a user asks for
  by name (a deck, a design) is a skill of its own; a kind nobody names (a chart, a diagram) stays a
  method inside one. Two ways to make one thing each say in their description which ask is theirs.
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
