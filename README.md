<div align="center">

<img src="docs/images/hero.png" alt="Thursday" width="760">

### Everyone wanted Friday. This is Thursday.

**A voice agent that lives on your machine.** You talk. It works. You keep talking.

[![npm](https://img.shields.io/npm/v/thursday-agent?style=flat-square&color=111&label=npm)](https://www.npmjs.com/package/thursday-agent)
[![CI](https://img.shields.io/github/actions/workflow/status/cgoinglove/thursday/ci.yml?style=flat-square&label=ci)](https://github.com/cgoinglove/thursday/actions/workflows/ci.yml)
[![MIT](https://img.shields.io/badge/license-MIT-111?style=flat-square)](LICENSE)
[![stars](https://img.shields.io/github/stars/cgoinglove/thursday?style=flat-square&color=111)](https://github.com/cgoinglove/thursday/stargazers)

[English](README.md) · [한국어](README.ko.md)

</div>

!![video: 60-second demo, 1440×900, light theme, no browser chrome. One call, start to finish: say "Hey Thursday", ask "I'm going to Kyoto next week, find me a coat under $200 and put the options on one page", she answers "On it — Navigator went to look", keep talking about something else while the job line appears under the call, the page opens by itself, she says "It's back". Cut a 12-second GIF of that take (from "On it" to the page opening) for right here → `docs/images/demo.gif`; the full take goes to YouTube, linked underneath.]

```bash
npx thursday-agent
```

One API key, typed into the first screen. No `.env`, no account, no cloud. That is the whole setup.

<br>

## Say this out loud

> **"I'm going to Kyoto next week — find me a coat under $200 and put the options on one page."**

She answers *"On it — Navigator went to look"* and **keeps talking to you.** A bot opens the shops in a real browser, reads the pages, builds the page. Two minutes later it opens on your screen.

You never watched a spinner. You never stopped talking.

<br>

## A harness you talk to

A **harness** is the layer around a model that decides what it sees, which tools it may call, where its commands run, and what survives the session. Claude Code, [OpenClaw](https://github.com/openclaw/openclaw) and [Hermes](https://github.com/NousResearch/hermes-agent) are harnesses, and they got very good this year.

**Every one of them is typed at.**

Not because nobody thought of speech. Because speech breaks the one thing a harness does: run a long loop. A voice model that opens a browser goes quiet for ninety seconds — and a quiet call is a dead call. Nobody holds a phone through that.

![Why a voice agent needs two minds](docs/images/two-minds.png)

So Thursday puts **two minds on one line.** A realtime speech model holds the conversation and may only touch what it can answer in a glance. Everything slower goes to a **bot** — a text model with your whole machine — that runs in the background and reports back in one sentence, out loud.

The conversation never stops, because the thing holding it never does the slow part.

### And the call can read a skill

A **skill** is a folder with a `SKILL.md` in it — a page of your instructions that a model opens only when it turns out to need them. It is how Claude Code, Codex and OpenClaw learn a house style without carrying it in every prompt.

Skills were built for agents you type at. Switch it on in Settings and **the voice model reads one mid-sentence** — so "book the usual place" stops being a sentence you have to finish. Bots have their own, always.

As far as I can find, nothing else lets a realtime speech model do this. The traffic goes the other way: the skills written *about* voice are instructions for a coding agent building a voice app. If you know of one, open an issue and this paragraph changes.

<details>
<summary><b>Isn't this what LiveKit and the Realtime API examples do?</b></summary>

The split is not new. OpenAI's own [realtime-agents](https://github.com/openai/openai-realtime-agents) demonstrates it as the "chat-supervisor" pattern, and [LiveKit Agents](https://github.com/livekit/agents) attaches MCP tools to a realtime session in a line.

They are frameworks and demonstrations: excellent parts for building a voice agent. What they hand the supervisor is a tool list.

Thursday hands it a machine — a shell, the Chrome you are already signed into, skills, connectors, a workspace, and jobs that keep running after you hang up. It is a harness first, and speech is how you operate it. That is the whole difference, and it is the half that takes the work.

</details>

<br>

## What a bot actually has

Not an API sandbox. **Your computer.**

- **A shell** — real commands on your real files
- **A real browser** — and it attaches to the Chrome you are *already signed into*. Your email, your accounts, your 2FA already done. **A cloud agent physically cannot do this.**
- **Skills** — the browser, this Mac, building a page; `npx skills add` for the rest
- **46 connectors** — Notion, GitHub, Linear, Slack, Figma, Stripe, Supabase… one click each
- **A studio** — image, video, speech, transcription
- **Each other** — a bot hands a part of its job to the bot that exists for it

![A bot gets your shell, your skills, and the Chrome you are already signed into](docs/images/machine.png)

It signs in where it has to, in a window you can watch, and stops at exactly one thing: **the password.** That half is yours. Everything else it finishes.

<br>

## One sentence. Three bots. You typed none of it.

![The room they sorted it out in](docs/images/task-thread.png)

Jarvis holds the job and decides neither half is his. Navigator opens six shops and reads them. Scribe builds the page out of what came back. It reaches you as one line, out loud — and the room is there to read if you ever want to know how.

<br>

## Hang up. It keeps going.

The job is not in the call. It runs on the server and the screen is a projection of it — so hang up mid-sentence, open a new tab, come back in ten minutes. She tells you what came in, or rings you, if you let her.

![The call ends at 0:12; the job runs to 2:41](docs/images/keeps-going.png)

Close the app entirely and it does the honest thing instead: ten seconds with no browser on it and every running job stops where it stands, keeps its thread, and waits for you to pick it back up. **Nothing spends your keys while you are not looking.**

<br>

## It remembers you, and you can read it

Plain notes on your disk. One fact per line. Open them in any editor; delete any of them.

And after every call a text model **re-reads what was actually said** and reconciles the notes with it — so what she keeps is not only what she thought to write down mid-sentence.

<br>

## Local-first, and here it is not a slogan

| | |
|---|---|
| **Your browser** | Bots attach to the Chrome already open on your desk — your sessions, your logins |
| **Your machine** | Real commands on real files. Not a VM with a copy |
| **Your keys** | A SQLite file on your disk, stripped from the shell a bot runs in |
| **Your memory** | Plain text notes you can open, edit and delete |
| **No account** | Nothing to sign up for. The "server" is a Node process on `127.0.0.1` |

**Honest caveat:** the *intelligence* is remote. There is no local realtime speech model worth putting a call on yet, so the audio goes to OpenAI or xAI. Everything else never leaves the machine. When a local voice model lands, this is the app that is ready for it.

<br>

## Install

```bash
npx thursday-agent
```

Opens at `localhost:3000`. One OpenAI or xAI key opens the call — a voice key is also a text key, so one is enough to run everything. Data lives in `~/.thursday`.

<details>
<summary><b>From source</b></summary>

```bash
git clone https://github.com/cgoinglove/thursday.git
cd thursday
pnpm install
pnpm dev
```

Node 22.18+ and pnpm 10+. The first run fetches the browser bots drive (~280 MB) in the background.

</details>

<details>
<summary><b>Which models can I use?</b></summary>

| | Providers |
|---|---|
| **Voice** (the call) | OpenAI Realtime · xAI Grok Voice |
| **Text** (the bots) | OpenAI · Anthropic · Google · xAI · Vercel AI Gateway — every model it carries, live |
| **Studio** | OpenAI · Google · xAI · Vercel AI Gateway |

Every bot can run on its own model. Give the errand-runner something cheap and the planner something good.

</details>

<details>
<summary><b>Ten more things to try saying</b></summary>

- "What did I download this week?" — one command, run while you talk
- "Remember my sister's birthday is March 3rd." — saved the moment it lands
- "Anything from my landlord in my email?" — attaches to the Chrome you are signed into
- "Set up a Google account just for my bots." — stops at the password, then carries on
- "Write up what we decided today as a one-pager." — opens as a document, not a chat bubble
- "Draw me a logo for a bakery called Crumb."
- "Go through my card statements and list every subscription I am paying for."
- "Book a table for four on Friday, somewhere my sister can actually eat."
- "Watch this page and tell me when the price drops."
- "Build me a page of thirty wedding pose photos."

</details>

<br>

## Where this is going

**0.x** — this web app. More harness: better bots, more skills, a wider studio, and whatever the first people who actually talk to her ask for.

**1.0** — a desktop app. The same server in a window, with the microphone and the machine one step closer.

Tell me what you said to her and where it stopped. That is the roadmap.

<br>

## The part where I am honest with you

She is a language model with a shell, a browser and your API keys. **That is the product, not an accident.** Keys never reach the shell. Writes are fenced to a workspace. The server is localhost-only. Passwords, one-time codes and passkeys stay yours to type.

It is not a sandbox and it does not pretend to be. → [SECURITY.md](SECURITY.md)

Built on macOS. Linux should work; Windows is untested.

<br>

---

<div align="center">

**If you have ever wanted to just talk to your computer while it worked — star it.**<br>
That is how I know to keep going.

[![Star History](https://api.star-history.com/svg?repos=cgoinglove/thursday&type=Date)](https://star-history.com/#cgoinglove/thursday&Date)

[How it works](docs/how-it-works.md) · [Contributing](CONTRIBUTING.md) · [Architecture](CLAUDE.md) · [MIT](LICENSE)

</div>
