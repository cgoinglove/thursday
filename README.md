<div align="center">

!![design: export the `Hero · social card` artboard from the brand canvas at 1200×630 (light theme) → `docs/images/hero.png`. Also set it as the GitHub social preview.]

# Thursday

**A voice agent that lives on your machine.**
Talk to her. She hands the slow work to bots with a shell, a browser and skills.

[![npm](https://img.shields.io/npm/v/thursday-agent?style=flat-square&color=111)](https://www.npmjs.com/package/thursday-agent)
[![CI](https://img.shields.io/github/actions/workflow/status/cgoinglove/thursday/ci.yml?style=flat-square&label=ci)](https://github.com/cgoinglove/thursday/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-111?style=flat-square)](LICENSE)
[![Node](https://img.shields.io/badge/node-%E2%89%A5%2022.18-111?style=flat-square)](package.json)

[English](README.md) · [한국어](README.ko.md)

</div>

> ### Everyone wanted Friday.
> Tony Stark had an AI he could just *talk to* while it went and did things. What the rest of us got was a text box and a spinner.
>
> **This is Thursday.** One day short of Friday, and open source.

!![video: 60-second demo, 1440×900, light theme, no browser chrome. One call, start to finish: say "Hey Thursday", ask "I'm going to Kyoto next week, find me a coat under $200 and put the options on one page", she answers "On it — Navigator went to look", keep talking about something else while the job line appears under the call, the page opens by itself, she says "It's back". Cut a 12-second GIF of the same take (from "On it" to the page opening) for the top of this README → `docs/images/demo.gif`; the full take goes to YouTube and is linked here.]

## The first harness you talk to

Agent harnesses got good this year. Claude Code, OpenClaw, Hermes — all of them read and type, and all of them are excellent at it. **None of them listen.**

Speech is not a skin you paint on a text agent, because it breaks the one thing a harness does: run a long loop. A speech model that opens a browser goes quiet for ninety seconds, and a quiet call is a dead call. Nobody sits in silence holding a phone.

So Thursday puts **two kinds of mind on one line.**

A realtime speech model holds the conversation and is only allowed to touch what it can answer in a glance — what she remembers about you, one file, one shell command. Anything slower she hands to a **bot**: a text model with the whole machine, running in the background, that reports back in one sentence she says out loud.

You never wait. You just keep talking.

```
you ──▶ Thursday ──delegate──▶ bot ──▶ shell · browser · files · MCP
         (seconds)                       (minutes, and it keeps going
          keeps talking ◀──report──       after you hang up)
```

## Install

```bash
npx thursday-agent
```

Opens at `localhost:3000`. One key opens the call — an OpenAI or xAI key, typed into the first screen. There is no `.env` to fill in, no account to make, no config file. Data lives in `~/.thursday`.

<details>
<summary>From source</summary>

```bash
git clone https://github.com/cgoinglove/thursday.git
cd thursday
pnpm install
pnpm dev
```

Node 22.18+ and pnpm 10+. The first run fetches the browser bots drive (~280 MB) in the background.

</details>

Built on macOS. Linux should work; Windows is untested.

## Try saying

The first ten minutes, in order. Each one shows a different part of her.

| Say | What happens |
|---|---|
| "Hey Thursday." | The call opens. On a first call she asks what to call you, and remembers. |
| "What did I download this week?" | One command, run while you talk. A shell is hers to use, not a job to hand over. |
| "Remember my sister's birthday is March 3rd." | Saved the moment it lands. Ask her next week. |
| "I'm going to Kyoto next week — find me a coat under $200 and put the options on one page." | **Navigator** opens the shops in a real browser and builds the page. She keeps talking to you the whole time. When it's back, the page opens on your screen. |
| "Anything from my landlord in my email?" | It attaches to the Chrome you're **already signed into**. Nothing to connect, no OAuth dance. |
| "Set up a Google account just for my bots." | **Jarvis** fills the form in a window you can watch, and stops at the password — that half is yours. Then he carries on. |
| "Write up what we decided today as a one-pager." | **Scribe** asks what it's for, then writes it. It opens as a document, not a chat bubble. |
| "Draw me a logo for a bakery called Crumb." | The studio: image, video, speech and transcription, on whichever key you already have. |

Then hang up. The jobs finish without you, and she tells you next time — or rings you, if you let her.

## Local-first, and it matters more than usual

Every agent claims privacy. For a voice agent that drives your browser, "local" is not a privacy checkbox — it is the **only way some of this works at all.**

- **Your browser, with your logins.** A cloud agent cannot read your email, because it isn't you. Thursday's bots attach to the Chrome already open on your desk — your sessions, your cookies, your 2FA already done. That is a whole category of work that simply cannot be outsourced.
- **Your machine.** Bots run real commands on your real files. Not a sandbox VM with a copy.
- **Your keys**, in a SQLite file on your disk, passed to the provider you chose and nowhere else. They are stripped from the environment a bot's shell runs in, so a compromised npm package can't read them.
- **Your memory**, as plain notes on disk. One fact per line. Open them in any editor; delete any of them.
- **No account, no telemetry, no server of ours.** The "server" is a Node process on your laptop, bound to `127.0.0.1`.

Honest caveat: the *intelligence* is remote. There is no local realtime speech model worth putting a call on yet, so the audio goes to OpenAI or xAI. Everything else — your files, your browser, your memory, the jobs — never leaves the machine. When a local voice model arrives, this is the app that's ready for it.

## How it works

!![design: export the `How it works` artboard from the brand canvas at 1200×560 → `docs/images/how-it-works.png`]

- **The call is a realtime speech model.** OpenAI Realtime or xAI Grok Voice — the whole conversation, any language, interruptions and all.
- **Bots are text models with the whole machine.** A shell, a real browser (Playwright), the filesystem, skills, MCP servers, and each other. They sign in where they must, with the window in front of you, and carry a job to the end: the thing bought, the account made, the page built.
- **Jobs outlive the call.** They run on the server, not in the tab. Hang up mid-job and it keeps going.
- **Memory is a folder of notes, and it keeps itself.** She reads before she answers and writes the moment something comes up. Then, after the call ends, a text model re-reads what was actually said and reconciles the notes with it — so what she remembers is not only what she thought to write down mid-sentence.

The longer version, with what each piece may and may not touch: [docs/how-it-works.md](docs/how-it-works.md).

## What comes with her

!![design: export the `Seed bots` artboard from the brand canvas at 1200×420 → `docs/images/bots.png`]

**Three bots**, split by temperament rather than subject — Jarvis plans and does whatever is left over, Navigator goes and looks, Scribe writes. Make your own in a minute: a name, a sentence, and optionally a model and a few pinned tools.

**Skills** the bots read before they start: the [browser](skills/browser/SKILL.md), [this Mac](skills/computer/SKILL.md), [an interactive page](skills/interactive-page/SKILL.md) for results that need pictures or controls, and the two that grow the set — [find a skill](skills/find-skills/SKILL.md), [write one](skills/skill-creator/SKILL.md). Anything from the open skills ecosystem installs with `npx skills add`.

**46 connectors, one click each** — Notion, GitHub, Linear, Slack, Figma, Stripe, Supabase, Cloudflare, Sentry and the rest — plus any MCP server you paste in. OAuth is handled; bots search the tools and call them. Pin a few to a bot and it skips the search.

**A studio** — image, video, speech, transcription — which bots see as one more connected server.

!![capture: the call screen mid-job in light theme, 1440×900 — Thursday's mark centred, one caption under it, the "Navigator is on it" pill, and the job line with its tool chips visible below. → `docs/images/call.png`]

!![capture: the Tasks view with one finished job open — the thread showing the request, a few tool lines (bash, browser), a report, and the artifact link. 1440×900, light theme. → `docs/images/task.png`]

## Models

| | Providers |
|---|---|
| **Voice** (the call) | OpenAI Realtime · xAI Grok Voice |
| **Text** (the bots) | OpenAI · Anthropic · Google · xAI · Vercel AI Gateway (every model it carries, live) |
| **Studio** | OpenAI · Google · xAI · Vercel AI Gateway |

One key is enough to start — a voice key is also a text key. Add more in settings; every bot can run on its own model.

## Where this is going

**0.x** is this web app: more harness. Better bots, more skills, a wider studio, and whatever the first people who actually talk to her ask for.

**1.0** is a desktop app — the same server in a window, with the microphone and the machine one step closer.

Tell me what you said to her and where it stopped. That's the roadmap.

## Security

She is a language model with a shell, a browser and your keys. That is the product, not an accident. Keys never reach the shell; writes are fenced to a workspace; the server is localhost-only; passwords, one-time codes and passkeys stay yours to type. What that does and doesn't cover: [SECURITY.md](SECURITY.md).

## Contributing

[CONTRIBUTING.md](CONTRIBUTING.md) is how to run it and what a good pull request looks like. [CLAUDE.md](CLAUDE.md) is the architecture — where every kind of code lives, and why.

## License

[MIT](LICENSE)
