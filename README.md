<div align="center">

<img src="docs/images/hero.png" alt="Thursday — an open-source voice agent with a face made of emoji" width="760">

### Everyone wanted Friday. This is Thursday.

**Your own Iron Man moment.**

Talk to your computer. Ask it to find something, make something, or get something done. Thursday talks back while agents do the work.

An open-source voice-first agent harness, in the same spirit as [OpenClaw](https://github.com/openclaw/openclaw) and [Hermes](https://github.com/NousResearch/hermes-agent). Running on your own machine.

[![npm](https://img.shields.io/npm/v/thursday-agent?style=flat-square&color=111&label=npm)](https://www.npmjs.com/package/thursday-agent)
[![CI](https://img.shields.io/github/actions/workflow/status/cgoinglove/thursday/ci.yml?style=flat-square&label=ci)](https://github.com/cgoinglove/thursday/actions/workflows/ci.yml)
[![MIT](https://img.shields.io/badge/license-MIT-111?style=flat-square)](LICENSE)
[![stars](https://img.shields.io/github/stars/cgoinglove/thursday?style=flat-square&color=111)](https://github.com/cgoinglove/thursday/stargazers)

[English](README.md) · [한국어](README.ko.md)

</div>

```bash
npx thursday-agent
```

Add one OpenAI or xAI key on the first screen. Then say **“hey thursday.”** No Thursday account and no `.env` file.

<br>

## “Thursday, help me get ready for my trip.”

Start with an idea. Work it out together, out loud.

> **“Find three quiet stays in Kyoto under $180. Put the best options on one page.”**

While a bot searches, keep talking: “Actually, somewhere I can walk to breakfast. What should I pack?” Thursday stays in the conversation while bots browse, compare, and build your page. When it is ready, the result comes back to you out loud and opens on your screen.

![One voice conversation continues while a bot works in the background](docs/images/two-minds.png)

That is the Friday feeling: you think out loud, your assistant answers, and work happens along the way.

<br>

## One sentence. Three bots. You typed none of it.

Thursday does not hand your request to a single agent and hope. The bots talk to each other.

![Jarvis splits the job, Navigator reads six shops, Scribe builds the page — a room nobody typed in](docs/images/task-thread.png)

Ask for a one-page lookbook of coats for the trip. **Jarvis** takes the job and decides neither part is its own. **Navigator** opens six shops in a real browser and brings back prices, links, and pictures. **Scribe** turns that into the page. Jarvis makes sure the pieces fit and hands the result to Thursday — and you hear one sentence.

Every handoff is written down. Open the room to see who did what, or type into it and the job picks up where it left off.

<br>

## Things worth saying out loud

| Say | What happens |
|---|---|
| **“What did I download this week?”** | Thursday runs one quick command and answers in the call. |
| **“Find the cheapest flight to Osaka on the 14th.”** | A bot searches in a real browser and leaves the useful page open. |
| **“Turn today’s decisions into a one-page brief.”** | A bot writes the file and opens the finished artifact. |
| **“Remember that I moved to Busan.”** | The fact goes into memory you can read, edit, and delete. |
| **“Plan three days in Kyoto, with a map for each day.”** | Bots research and build a visual itinerary together. |
| **“Anything from my landlord in email?”** | A bot checks the browser session you chose to attach and reports back. |

<br>

## Make it your kind of assistant

- **Keep talking while it looks.** Bots handle the slow work. You can interrupt Thursday, change the subject, or think through the next idea together.
- **Put your computer to work.** Bots use a shell, your files, and a real browser. Attach the Chrome session you choose to work with services you already use.
- **Get something you can use.** Open the finished page, document, image, audio, or video. Keep the files and build on them.
- **Explain yourself less next time.** Save preferences in memory and repeatable methods in Agent Skills. Read, edit, or delete what Thursday remembers.
- **Bring your tools and models.** Connect MCP servers, choose models, and create bots with their own roles, tools, and memory.
- **End the call when you are done talking.** Jobs keep working while the app stays open. Close the app and they pause until you return.

Thursday ships with Jarvis to plan, Navigator to browse, and Scribe to write. Make your own with a name and one sentence about what it is for — and when a real decision is needed, a bot asks you.

<br>

## Local-first, precisely

The app, database, workspace, keys, memory, and browser sessions live on your computer. The server binds to `127.0.0.1`; there is no Thursday account or hosted control plane.

Calls and agent tasks still use the model providers you configure. A connected service receives the requests you deliberately send through it. Thursday is a powerful local agent with a real shell, not a security sandbox — read [SECURITY.md](SECURITY.md) before giving it sensitive access.

<br>

## Install

```bash
npx thursday-agent
```

Requires Node 22.18+. It opens on `localhost:3000`, or the next free port. The first run downloads the Chromium browser used by bots once, in the background. Built on macOS; Linux should work, and Windows is not yet tested.

```text
~/.thursday
├── local.db          calls, memory, bots, jobs, keys
└── .ai-workspace
    ├── artifacts/    finished work
    ├── projects/     code and longer-lived projects
    ├── bots/         each bot's memory and saved sessions
    └── .agents/      skills you installed
```

<details>
<summary><b>Models and providers</b></summary>

| | Providers |
|---|---|
| **Voice** | OpenAI Realtime · xAI Grok Voice |
| **Bots** | OpenAI · Anthropic · Google · xAI · Vercel AI Gateway · ChatGPT sign-in |
| **Studio** | OpenAI · Google · xAI · Vercel AI Gateway |

Every bot can use a different model.

</details>

<details>
<summary><b>Run from source</b></summary>

```bash
git clone https://github.com/cgoinglove/thursday.git
cd thursday
pnpm install
pnpm dev
```

Requires pnpm 10+.

</details>

<br>

## Your Friday starts with “hey thursday.”

You do not need a suit of armor. Start with one thing you would rather say than do by hand.

The project is in active `0.x` development. Tell us what you asked for and where it stopped — that is the roadmap.

<div align="center">

**If you want an agent you can talk to while it works, [star Thursday](https://github.com/cgoinglove/thursday).**

[How it works](docs/how-it-works.md) · [Contributing](CONTRIBUTING.md) · [Architecture](AGENTS.md) · [MIT](LICENSE)

</div>
