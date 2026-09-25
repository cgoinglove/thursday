<div align="center">

<a href="https://youtu.be/7XmsAtwQGjo">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/cgoinglove/thursday/main/docs/images/hero-dark.png">
    <img src="https://raw.githubusercontent.com/cgoinglove/thursday/main/docs/images/hero-light.png" alt="Thursday — an open-source voice assistant on GPT-Live 1, with a team of AI bots: one has finished a page, another is searching the web" width="880">
  </picture>
</a>

**An open-source voice assistant on GPT-Live 1, with a team of AI bots behind it.**<br>
Runs on your computer, on your own OpenAI key. You talk; bots take the slow work to a real browser, a shell and your files.

[![npm](https://img.shields.io/npm/v/thursday-agent?style=flat-square&color=111&label=npm)](https://www.npmjs.com/package/thursday-agent)
[![CI](https://img.shields.io/github/actions/workflow/status/cgoinglove/thursday/ci.yml?style=flat-square&label=ci)](https://github.com/cgoinglove/thursday/actions/workflows/ci.yml)
[![MIT](https://img.shields.io/badge/license-MIT-111?style=flat-square)](LICENSE)
[![node](https://img.shields.io/node/v/thursday-agent?style=flat-square&color=111)](https://nodejs.org)
[![discord](https://img.shields.io/badge/discord-join-111?style=flat-square&logo=discord&logoColor=white)](https://discord.gg/Qmysdh9Fy8)

[English](README.md) · [한국어](README.ko.md) · [▶ Watch the film](https://youtu.be/7XmsAtwQGjo) · [a real call](https://youtu.be/V7fBDY3cYRU)

</div>

## Quick start

```bash
npx thursday-agent
```

Needs Node.js 22.18+ and one OpenAI API key, pasted into the first screen. Pick your starter bots and **tap her face**. No account, no `.env`. The voice costs about $0.05 a minute on that key.

## Try saying

- “Find me a coat under two hundred dollars and put the options on one page.”
- “Every weekday at nine, go through my mail and draft the replies.”
- “Remember my sister's birthday is March third.”
- “Where is that coat job?”, while it is still running.

### Talk while it works

A speech model that opens a browser goes silent for a minute, and a silent call is a dead call. So anything slower than a few seconds goes to a bot, and she keeps talking — interrupt her, change the subject, or ask how the job is going.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/cgoinglove/thursday/main/docs/images/talk-dark.png">
  <img src="https://raw.githubusercontent.com/cgoinglove/thursday/main/docs/images/talk-light.png" alt="On a call: she says a bot is on it and will tell you when it is back. Below, the job is handed over and a web search starts" width="880">
</picture>

### One ask, a whole team

Bots hand parts of a job to each other, check what comes back, and ask you only when a decision is yours. Every handoff is saved: open the thread to see who did what, or step in.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/cgoinglove/thursday/main/docs/images/team-dark.png">
  <img src="https://raw.githubusercontent.com/cgoinglove/thursday/main/docs/images/team-light.png" alt="A thread between two bots: one hands the job over, the other reports what it compared, and a question waits on you" width="880">
</picture>

### Errands, in a real browser

Orders, bookings, forms, the inbox. A bot uses its own browser or the Chrome you are already signed into. A purchase stops at the Pay button, left open on your screen for you to press.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/cgoinglove/thursday/main/docs/images/errands-dark.png">
  <img src="https://raw.githubusercontent.com/cgoinglove/thursday/main/docs/images/errands-light.png" alt="A checkout in a browser a bot drove: filled in, stopped at the Pay button, left open on your screen" width="880">
</picture>

### Results you can keep

Pages, charts, videos, slides, docs and scripts, saved as files on your machine. A finished one shows up in the corner of your screen, and “show me” opens it.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/cgoinglove/thursday/main/docs/images/results-dark.png">
  <img src="https://raw.githubusercontent.com/cgoinglove/thursday/main/docs/images/results-light.png" alt="A page a bot made, with the file it saved named beside it" width="880">
</picture>

## And also

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/cgoinglove/thursday/main/docs/images/more-dark.png">
  <img src="https://raw.githubusercontent.com/cgoinglove/thursday/main/docs/images/more-light.png" alt="Your crew: pick starter bots or make your own, each on the model you choose. From your phone: write to her from Telegram, Discord or Slack. Routines: every weekday at nine, a bot, a job and a time. Memory you can read: plain notes you can open, edit or delete" width="880">
</picture>

## How it works

Thursday is an open-source voice assistant that runs on your own computer. OpenAI's GPT-Live 1 holds the call, and a Responses model runs its tools. Anything slower than a few seconds goes to a background bot: a text model from OpenAI, Anthropic, Google or xAI, with a shell, a real browser, your files, Agent Skills and MCP servers. Bots hand parts of a job to each other and ask you when a decision is yours; their results and questions come back into the live call, and jobs keep running after you hang up. Routines start jobs on a schedule. What she knows about you is plain notes you can read. You can write to her instead of talking, from the app or from Telegram, Discord or Slack. [Read more →](docs/how-it-works.md)

## Before you run it

- **The models are not local.** The app, your data and your keys stay on your machine. Call audio goes to OpenAI, and bots run on the providers you add. Local endpoints for bots are [an open issue](https://github.com/cgoinglove/thursday/issues/16).
- **It is not a sandbox.** Bots run real commands as you. Stopping at Pay and asking before using a login are instructions a model follows, not locks. Read [SECURITY.md](SECURITY.md) before giving it access to anything sensitive.
- **Built on macOS.** Linux should work; Windows is not tested yet. Screens are in English; she speaks your language.

<details>
<summary><b>What does it cost?</b></summary>

Thursday is free and MIT-licensed. You bring the keys: OpenAI bills the voice at about $0.05 a minute while a call is open, silence included ([pricing](https://developers.openai.com/api/docs/pricing)). Bots bill per token on whichever provider you pick for them.

</details>

<details>
<summary><b>Where does my data go?</b></summary>

What you say on a call and what bots work on go to the model providers you set up and the services you connect. The “hey thursday” wake phrase is off until you switch it on: it uses your browser's speech recognition, which in Chrome sends microphone audio to Google while the tab is open. A tap on her face starts a call without it. The app listens on `127.0.0.1`, and your calls, memory and files live in `~/.thursday` (or the checkout, when you run from source).

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

<div align="center">

<br>

Everyone wanted Friday. This is Thursday.

**[How it works](docs/how-it-works.md)** · [Contributing](CONTRIBUTING.md) · [Security](SECURITY.md) · [MIT](LICENSE)

Ran it? [Tell me where it stopped](https://github.com/cgoinglove/thursday/issues/new): that list is the roadmap.<br>
A question? [Ask on Discord](https://discord.gg/Qmysdh9Fy8).

</div>
