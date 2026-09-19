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

- **A seed names no skill.** A bundled skill can be switched off too, and calling one that is not
  there answers `No skill named`. The seed says to call a method from the Skills list when one
  fits, and otherwise to find and install one with `find-skills` — naming no pack. The exceptions
  are the tool of the bot's trade (the browser skill) and a structural dependency such as
  `requires`.
- **A bot's folder is "your own folder".** A `bots/<name>/…` path breaks when the bot is renamed.
- **No outside conventions in a seed.** An external pack's file paths (`.agents/product-marketing.md`
  and the like) or a new place to store things stay out; a skill that needs such a file handles it.
- **A seed is read on first install only.** A change to its text carries no upgrade or migration for
  rows already installed.
- Jarvis's empty role (`systemPrompt: ""`) is deliberate and stays empty.
- Planner owns the result without making it, as a CEO does. Its coordination is not weakened, and
  skill names, other bots' names and making skills do not go back in. Adding it to the
  `recommended` set puts one more face in the intro, which is a visible change.

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

- **A new capability extends an existing skill first** — `interactive-page` for anything shaped like
  a result — or a few lines of its description. A good external skill may come in whole, engine and
  all (archify).
- **A main `SKILL.md` holds one or two facts the model does not know.** Procedures go in
  `references/`.
- **An external skill is chosen by its GitHub stars and by reading its repository**, not by its
  install count on skills.sh: one had half a million installs and five stars.
