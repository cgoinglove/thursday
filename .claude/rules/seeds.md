---
paths:
  - "features/bot/bot.seed.ts"
  - "features/bot/seed-bots.ts"
  - "seed-skills/**"
  - "skills/**"
  - "features/skills/**"
---

# Seed bots and skills

The head comment of `bot.seed.ts` comes first: a role names no bot, its own or another, and a part
it hands out has a way through when nobody on the roster is for it. This adds what it does not say.

## Seed prompts

- **A seed names no skill, no tool procedure, and nothing the base prompt already says.** A
  bundled skill can be switched off too, and calling one that is not there answers `No skill
  named`; the base prompt already lists every skill with its description and says to open one
  before a job it covers. How to sign in, pay, or send a question is the tool's and the browser
  skill's to say — a sentence about it in a role is a copy that drifts (the sign-in order was
  wrong in four places at once). A role holds what only it knows: what is this bot's, what it
  ends as, the judgement only this role makes, what it keeps in memory. The exceptions are the
  tool of the bot's trade and a structural dependency such as `requires`. A skill is that tool
  when the bot's whole output comes out of it, not when it is one method among several: the
  browser for anything that reads a page; design, slides and the page skill for the bot that
  makes what is looked at. All are named from `config.ts` (BROWSER_SKILL, DESIGN_SKILL,
  SLIDES_SKILL, PAGE_SKILL), never spelled in the prose — a bot that has to find its own trade
  through a description list writes the thing by hand instead, which is what Designer did on
  09-22.
- **What a job repeats is a kit script, not a paragraph.** Reading a web app through snapshots
  costs tens of thousands of characters a look; a script that fetches the same rows costs a few
  hundred (Analyst's series fetch). A kit script stands on a public API, a managed tool (yt-dlp,
  a library) or the app's own scripts — never on another site's markup, its private endpoints
  or a pinned client version, which break the day that site changes and break quietly. What a
  script cannot get that way is read once through the browser skill, or put on the user's
  screen. It fails loudly, never with an empty result. It drives the browser only through
  `$THURSDAY_SKILLS/browser/scripts/session.mjs`, which opens a headless browser itself when
  none is open, and takes `render`, `sheet`, `webimage` and `chart` from the shipped skills
  rather than keeping a copy; `render` serves on port 0, so concurrent jobs never share one.
- **A kit script stands alone past that.** The ten lines that walk up to the workspace folder are
  copied in each kit on purpose: a kit is copied into a bot's folder, and one more shared file is
  one more thing that has to be there for it to run. Leave the copies.
- **A bot's folder is "your own folder".** A `bots/<name>/…` path breaks when the bot is renamed.
- **No outside conventions in a seed.** An external pack's file paths (`.agents/product-marketing.md`
  and the like) or a new place to store things stay out; a skill that needs such a file handles it.
- **A seed is read on first install only.** A change to its text carries no upgrade or migration for
  rows already installed.
- Jarvis's empty role (`systemPrompt: ""`) is deliberate and stays empty.
- **No seed coordinates the others.** A coordinator seed was tried and dropped: on the same
  research job it spent 1.8x the tokens and 1.9x the time of the generalist for no better result,
  and the generalist handed a part to another bot by itself. A bot that needs help asks for it.
- **Every seed installs by default and shows in the intro's opening loop**, so a new seed is one
  more face there, which is a visible change.

## A seed's script is run before it is written

- Do the job by hand in a shell first and time the shortest sequence of commands. The traps show
  there, not in docs: a path panel covering the map, the browser skill refusing `file:` URLs,
  concurrent jobs sharing one fixed port and capturing each other's pages.
- A slow bot is usually a turn per command, not the model: tell it to batch commands into one bash
  call (25 tool calls became 3). An instruction without a count ("one screenshot per leg") runs
  away; pin it ("one and only one").
- A screen whose state no URL can set (a composer whose refs change with every snapshot) takes a
  snapshot between clicks. That is normal, not slow.

## Skills

- **A new capability extends an existing skill first** — `interactive-page` for a page, `design`
  for a board, `slides` for a slide — or a few lines of its description. A good external skill
  may come in whole, engine and all (archify).
- **A skill's name is the first thing a bot matches a job against.** A kind of result a user
  asks for by name — a deck, a design — is a skill of its own (`slides`, `design`); a kind
  nobody names (a chart, a diagram) stays a method inside one. Under one umbrella name,
  bots opened it unprompted in 0 of 2 jobs; split and named, 6 of 6, a bot with no role
  included (09-22). Two ways to make one thing
  (the deck here and the office `deck` of the Docs kit) each say in their description which
  ask is theirs.
- **A main `SKILL.md` holds one or two facts the model does not know.** Procedures go in
  `references/`.
- **`load_skill` lists a skill's files shallowest first, up to `SKILL_FILES_LISTED`**, and says
  how many it left out. What a `SKILL.md` points at sits directly in `references/` and
  `scripts/`; a bundled engine or a component kit goes a folder deeper, where a cut list drops
  it first.
- **An external skill is chosen by its GitHub stars and by reading its repository**, not by its
  install count on skills.sh: one had half a million installs and five stars.
