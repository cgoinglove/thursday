<div align="center">

!![design: export the `Hero · social card` artboard from the brand canvas at 1200×630 (light theme) → `docs/images/hero.png`. Also set it as the GitHub social preview.]

# Thursday

**A voice agent that runs on your own machine.**
Talk to her. She hands the slow work to bots with a shell, a browser and skills.

[![npm](https://img.shields.io/npm/v/thursday-agent?style=flat-square&color=111)](https://www.npmjs.com/package/thursday-agent)
[![CI](https://img.shields.io/github/actions/workflow/status/cgoing/thursday/ci.yml?style=flat-square&label=ci)](https://github.com/cgoing/thursday/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-111?style=flat-square)](LICENSE)
[![Node](https://img.shields.io/badge/node-%E2%89%A5%2022.18-111?style=flat-square)](package.json)

[English](README.md) · [한국어](README.ko.md)

</div>

!![video: 60-second demo, 1440×900, light theme, no browser chrome. One call, start to finish: say "Hey Thursday", ask "I'm going to Kyoto next week, find me a coat under $200 and put the options on one page", she answers "On it — Navigator went to look", keep talking about something else while the job line appears under the call, the page opens by itself, she says "It's back". Cut a 12-second GIF of the same take (from "On it" to the page opening) for the top of this README → `docs/images/demo.gif`; the full take goes to YouTube and is linked here.]

Most agents are a text box. Thursday is a call. You say what you want, in your own words, and keep talking — the work happens behind the conversation, on your machine, and does not stop when you hang up.

Two kinds of mind share the line. A realtime speech model holds the conversation and only touches what can be answered in a glance: what she remembers about you, one file. Anything that takes longer — a browser, a shell, a service, a minute-long job — goes to a text-model bot that runs in the background and reports back in one sentence, said out loud.

## Install

```bash
npx thursday-agent
```

Opens at `http://localhost:3000`. One key opens the call — an OpenAI or xAI key, typed into the first screen. There is no `.env`; everything else is set inside the app. Data lives in `~/.thursday`.

<details>
<summary>From source</summary>

```bash
git clone https://github.com/cgoing/thursday.git
cd thursday
pnpm install
pnpm dev
```

Node 22.18+ and pnpm 10+. The first run fetches the browser bots drive (~280 MB) in the background.

</details>

Built on macOS. Linux should work; Windows is untested.

## Try saying

The first minute, in order. Each one shows a different part of her.

| Say | What happens |
|---|---|
| "Hey Thursday." | The call opens. On a first call she asks what to call you, and remembers. |
| "What's in my Downloads folder from this week?" | One command, done while you talk — a shell is hers to use, not a job to hand over. |
| "Remember that my sister's birthday is March 3rd." | Saved the moment it lands. Ask about it next week. |
| "Find me a coat under $200 for Kyoto next week and put the options on one page." | **Navigator** opens the shops in a real browser and builds the page. She keeps talking. When it is back, the page opens on your screen. |
| "Check my email for anything from the landlord." | The bot attaches to the browser you are already signed into. Nothing to configure. |
| "Set up a Google account just for my bots to use." | **Jarvis** fills the form in a window you can see and stops at the password — that part is yours. Then he carries on. |
| "Write up what we decided today as a one-page brief." | **Scribe** asks what it is for, then writes it — and it opens as a document, not a chat bubble. |
| "Draw me a logo for a bakery called Crumb." | The studio: image, video, speech and transcription models, on whichever key you have. |

Hang up whenever. The jobs finish without you, and she tells you next time — or rings you, if you let her.

## How it works

!![design: export the `How it works` artboard from the brand canvas at 1200×560 → `docs/images/how-it-works.png`]

- **The call is a realtime speech model.** OpenAI Realtime or xAI Grok Voice — the whole conversation, in any language, with interruptions. She has memory, one file and a shell for the one-liners, and nothing that would leave the line silent.
- **Bots are text models with the whole machine.** A shell, a real browser (Playwright), the filesystem, skills, MCP servers, and each other. They sign in where they have to, with the window in front of you, and carry a job to the end: the thing bought, the account made, the page built.
- **Jobs outlive the call.** They run on the server, not in the tab. What the screen draws and what she reads back are the same rows.
- **Memory is a folder of notes, and it is yours.** Facts one per line, dates as dates, on your disk. She reads before she answers and writes the moment something comes up. You can open every note.

The longer version, with what each piece may and may not touch: [docs/how-it-works.md](docs/how-it-works.md).

## What comes with her

!![design: export the `Seed bots` artboard from the brand canvas at 1200×420 → `docs/images/bots.png`]

**Three bots**, split by temperament rather than subject — Jarvis plans and does whatever is left, Navigator goes and looks, Scribe writes. Make your own in a minute: a name, a sentence, and optionally a model and a few pinned tools.

**Skills** the bots read before they start: the [browser](skills/browser/SKILL.md), [this Mac](skills/computer/SKILL.md), [an interactive page](skills/interactive-page/SKILL.md) for results that need pictures or controls, and the two that grow the set — [find a skill](skills/find-skills/SKILL.md), [write one](skills/skill-creator/SKILL.md). Anything from the open skills ecosystem installs with `npx skills add`.

**MCP servers**, with OAuth. Connect one in settings; bots search its tools and call them. Pin a few to a bot and they skip the search.

**A studio** — image, video, speech and transcription — exposed to bots as one more server.

!![capture: the call screen mid-job in light theme, 1440×900 — Thursday's mark centred, one caption under it, the "Navigator is on it" pill, and the job line with its tool chips visible below. → `docs/images/call.png`]

!![capture: the Tasks view with one finished job open — the thread showing the request, a few tool lines (bash, browser), a report, and the artifact link. 1440×900, light theme. → `docs/images/task.png`]

## Models

| | Providers |
|---|---|
| **Voice** (the call) | OpenAI Realtime · xAI Grok Voice |
| **Text** (the bots) | OpenAI · Anthropic · Google · xAI · Vercel AI Gateway (every model it carries, live) |
| **Studio** | OpenAI · Google · xAI · Vercel AI Gateway |

One key is enough to start: a voice key is also a text key. Add more in settings; each bot can run on its own model.

## Where this is going

**0.x** is this web app: more of the harness — better bots, more skills, a wider studio — and everything the first users ask for.
**1.0** is a desktop app: the same server, in a window, with the microphone and the machine one step closer.

Open an issue with what you would say to her and where it stopped. That is the roadmap.

## Security

She is a language model with a shell, a browser and your keys. That is the product. Keys stay on your machine and never reach the shell; bots write inside a workspace; the server binds to localhost; passwords, one-time codes and passkeys are yours to type. What that does and does not cover: [SECURITY.md](SECURITY.md).

## Contributing

[CONTRIBUTING.md](CONTRIBUTING.md) is how to run it and what a good pull request looks like. [CLAUDE.md](CLAUDE.md) is the architecture — where every kind of code lives and why.

## License

[MIT](LICENSE)
