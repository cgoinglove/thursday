<div align="center">

<img src="docs/images/hero.png" alt="Thursday — an open-source voice agent with a face made of emoji" width="760">

### Everyone wanted Friday. This is Thursday.

**An open-source voice agent that lives on your machine.** You talk. It works. You keep talking.

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

One API key, typed into the first screen. Then say **"hey thursday."** No `.env`, no account, no cloud. That is the whole setup.

<br>

## Say this out loud

> **"I'm going to Kyoto next week — find me a coat under $200 and put the options on one page."**

She answers *"On it — Navigator went to look"* and **keeps talking to you.** A bot opens the shops in a real browser, reads the pages, builds the page. Two minutes later it opens on your screen.

You never watched a spinner. You never stopped talking.

<br>

## She has a face, and it is made of emoji

<div align="center">
<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/images/face-dark.png">
  <img src="docs/images/face-light.png" alt="Thursday's face: an orb of emoji that swells when she speaks" width="280">
</picture>
</div>

Hundreds of them, packed into one orb. When she talks, the rim swells with her voice and every syllable shakes a few loose — you can tell she is speaking with the sound off.

Rather have letters, a sprinkle, or a plain mark with two eyes? Settings › Thursday.

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

Thursday hands it a machine — a shell, a real browser, skills, connectors, a workspace, and jobs that keep running after you hang up. It is a harness first, and speech is how you operate it. That is the whole difference, and it is the half that takes the work.

</details>

<br>

## What a bot actually has

Not an API sandbox. **Your computer** — down to the Chrome you are already signed into, which no agent in someone else's cloud can borrow.

- **A shell** — real commands on your real files
- **A real browser** — its own, or attached to your Chrome. When there is something for you to see — a checkout, a map, a sign-in — it opens a window on your screen and leaves it there
- **Skills** — the browser, this Mac, building a page; `npx skills add` for the rest
- **46 connectors** — Notion, GitHub, Linear, Slack, Figma, Stripe, Supabase… one click each
- **A studio** — image, video, speech, transcription
- **Its own memory** — what it learned doing the job, kept as files you can open on its page
- **Each other** — a bot hands a part of its job to the bot that exists for it

![A bot gets your shell, your skills and a real browser — and leaves the checkout for you](docs/images/machine.png)

It signs in the way you would let it: a session it kept, your own Chrome, you in the window it opened, or the login you gave it — after asking. And there is one button it never presses: **pay.** It takes the order to the last screen, leaves it open in front of you, and tells you what it buys and for how much.

<br>

## One sentence. Three bots. You typed none of it.

![The room they sorted it out in](docs/images/task-thread.png)

Jarvis holds the job and decides neither half is his. Navigator opens six shops and reads them. Scribe builds the page out of what came back. It reaches you as one line, out loud — and the room is there to read if you ever want to know how.

Those three come with her. Two more are ready-made in Settings — **Insta** draws the post, writes the caption and puts it up once you say so; **Voyage** plans the trip with a map for each day — and one of your own takes a name and a sentence.

<br>

## Hang up. It keeps going.

The job is not in the call. It runs on the server and the screen is a projection of it — so hang up mid-sentence, open a new tab, come back in ten minutes. She tells you what came in, or rings you, if you let her. The tab says it too: `(2) Thursday` means two things are waiting on you.

![The call ends at 0:12; the job runs to 2:41](docs/images/keeps-going.png)

Close the app and it does the honest thing: ten seconds with no browser on it and every running job stops where it stands. **Nothing spends your keys while you are not looking.** Open it again and they pick themselves back up — the same after a restart, a `Ctrl+C`, or a model that went quiet for a minute.

<br>

## It remembers you, and you can read it

One fact per line, in the database on your disk. Open the Memory screen and read every one — where it came from, when it landed, whether it rides in every call — and delete any of them. Or type what changed, *"I moved to Busan"*, and watch the edit land.

Every fact remembers the call it was said in, so when one line is not enough she can go back and read the conversation.

<br>

## Local-first, and here it is not a slogan

| | |
|---|---|
| **Your browser** | Bots drive a real browser on your machine — and can attach to the Chrome already open on your desk |
| **Your machine** | Real commands on real files. Not a VM with a copy |
| **Your keys** | A SQLite file on your disk, stripped from the shell a bot runs in |
| **Your memory** | Facts in a database on your disk. Read, edit and delete them on the screen |
| **No account** | Nothing to sign up for. The "server" is a Node process on `127.0.0.1` |

**Honest caveat:** the *intelligence* is remote. There is no local realtime speech model worth putting a call on yet, so the audio goes to OpenAI or xAI. Everything else never leaves the machine. When a local voice model lands, this is the app that is ready for it.

<br>

## Install

```bash
npx thursday-agent
```

Opens at `localhost:3000`, or the next free port if something already has it. One OpenAI or xAI key opens the call — a voice key is also a text key, so one is enough to run everything.

### Running it

It runs in the terminal you started it in, like `n8n`. There is no daemon and nothing is installed into your login items.

| | |
|---|---|
| **Stop it** | `Ctrl+C` — running jobs are parked and pick up at the next start |
| **Start it again** | the same `npx thursday-agent` |
| **Close the terminal** | it stops with the terminal — nothing is left running |
| **Keep it up while you work** | run it in its own tab, or `npx thursday-agent &` |
| **Another port** | `npx thursday-agent --port 4000` |
| **Somewhere else on disk** | `npx thursday-agent --home ~/work/thursday` |

**Your data outlives all of it.** Everything you say, everything the bots write, your keys and your memory live in `~/.thursday`, never inside the package — so restarting, rebooting, or upgrading to the next version keeps every call and every file. Deleting that folder is the uninstall.

```
~/.thursday
├── local.db          calls, memory, bots, jobs, keys
└── .ai-workspace
    ├── artifacts/    what the bots made for you
    ├── projects/     code they build
    ├── bots/         each bot's own memory and kept sign-ins
    ├── .agents/      skills you installed
    └── scratch/      one folder per job, cleared three days after it ends
```

The first run also fetches the browser bots drive (~280 MB) in the background, once. That one lands in Playwright's own cache — `~/Library/Caches/ms-playwright`, or `~/.cache/ms-playwright` on Linux — so every run after it, and every upgrade, skips the download.

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
| **Text** (the bots) | OpenAI · Anthropic · Google · xAI · Vercel AI Gateway — every model it carries, live · your ChatGPT plan, by signing in |
| **Studio** | OpenAI · Google · xAI · Vercel AI Gateway |

Every bot can run on its own model. Give the errand-runner something cheap and the planner something good.

</details>

<details>
<summary><b>Ten more things to try saying</b></summary>

- "What did I download this week?" — one command, run while you talk
- "Remember my sister's birthday is March 3rd." — saved the moment it lands
- "Anything from my landlord in my email?" — read in the Chrome you are signed into
- "Find the cheapest flight to Osaka on the 14th." — left at the pay button, on your screen
- "Plan three days in Kyoto, with a map for each day." — Voyage
- "Make a post about Friday's gig and put it on Instagram." — Insta, once you say so
- "Write up what we decided today as a one-pager." — opens as a document, not a chat bubble
- "Go through my card statements and list every subscription I am paying for."
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

She is a language model with a shell, a browser and your API keys. **That is the product, not an accident.** Keys are stripped from the environment the shell runs in. The server is localhost-only. A login you gave a bot is asked about before it is used, and a payment is left for you to press — instructions a skill carries, not a lock the code holds.

The shell is not fenced, and it is not meant to be — a bot that cannot look around cannot do the job, and a command writes wherever you can. That includes the database your keys sit in.

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
