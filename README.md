<div align="center">

<img src="docs/images/hero.png" alt="Thursday — an open-source voice assistant with a face made of emoji" width="760">

### Everyone wanted Friday. This is Thursday.

**An open-source voice assistant on GPT-Live 1 that runs on your computer, with a team of AI bots behind it.**<br>
You talk. Bots take the slow work to a real browser, a shell and your files, and she keeps talking while they work.

[![npm](https://img.shields.io/npm/v/thursday-agent?style=flat-square&color=111&label=npm)](https://www.npmjs.com/package/thursday-agent)
[![CI](https://img.shields.io/github/actions/workflow/status/cgoinglove/thursday/ci.yml?style=flat-square&label=ci)](https://github.com/cgoinglove/thursday/actions/workflows/ci.yml)
[![MIT](https://img.shields.io/badge/license-MIT-111?style=flat-square)](LICENSE)
[![node](https://img.shields.io/node/v/thursday-agent?style=flat-square&color=111)](https://nodejs.org)

[English](README.md) · [한국어](README.ko.md)

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

## Talk while it works

A speech model that opens a browser goes silent for a minute, and a silent call is a dead call. So Thursday splits the call in two: GPT-Live 1 holds the conversation, and anything slower than a few seconds goes to a bot in the background. Interrupt her, change the subject, or ask how the job is going.

![A voice call with Thursday while a bot looks for hotels in the background](docs/images/call.png)

## One sentence, a whole team

Bots hand parts of a job to each other, check what comes back, and ask you only when a decision is yours. Every handoff is saved: open the thread to see who did what, or step in.

![A planner bot splits a trip request between two bots and one asks the user a question](docs/images/room.png)

## Errands, in a real browser

Orders, bookings, forms, the inbox. Bots use their own browser or the Chrome you're already signed into, and ask before using a login you gave them. A purchase stops at the Pay button, left open on your screen.

![A checkout a bot filled in and left open, with the Pay button for the user to press](docs/images/errands.png)

## Results you can keep

Pages, charts, videos, slides, docs and scripts, saved as files on your machine. A finished one shows up in the corner of your screen, and “show me” opens it.

![Files made by six different bots: a rent chart, a short video, a carousel, a trip page, launch copy, and a script](docs/images/artifacts.png)

## Your crew

Pick starter bots on the first run, or make your own with a name and one sentence about what it's for. Give each its own model and tools.

![A lineup of bots, each with its own face and job, plus a slot to make your own](docs/images/bots.png)

## And also

- **Hang up, it keeps going.** Jobs run on your machine, and Thursday tells you when they finish, or rings your screen if you turn that on.
- **From your phone.** Write to her from Telegram, Discord or Slack while the app runs at home. Nothing on your computer is opened to the internet.
- **Type instead.** Press `/` and write to her: the same memory and bots, no microphone, nothing billed by the minute.
- **Routines.** “Every weekday at nine, go through my mail”: a bot, a job and a time, set up by saying it.
- **Memory you can read.** What she knows about you is plain notes. Open, edit, or delete any line.
- **Skills and MCP.** Teach bots new methods with Agent Skills, and connect any MCP server.
- **Any model.** OpenAI, Anthropic, Google, xAI, Vercel AI Gateway, or your ChatGPT sign-in, per bot.
- **Local-first.** No Thursday account and no server of ours. The app, your data and your keys stay on your computer.

## Requirements

- Node.js 22.18+
- An OpenAI API key for the voice
- macOS. Linux should work; Windows is not tested yet.

<details>
<summary><b>What does it cost?</b></summary>

Thursday is free and MIT-licensed. You bring the keys: OpenAI bills the voice at about $0.05 a minute while a call is open, silence included ([pricing](https://developers.openai.com/api/docs/pricing)), and a call with nothing said for 20 seconds hangs up by itself. Bots use whichever provider you pick for them.

</details>

<details>
<summary><b>Where does my data go?</b></summary>

What you say on a call and what bots work on go to the model providers you set up and the services you connect. The “hey thursday” wake phrase is off until you switch it on: it uses your browser's speech recognition, which in Chrome sends microphone audio to Google while the tab is open. A tap on her face or `alt+shift+T` starts a call without it. The app listens only on `127.0.0.1`, and your calls, memory and files live in `~/.thursday` (or the checkout, when you run from source).

</details>

<details>
<summary><b>Is it safe to let bots use my computer?</b></summary>

Bots run real commands, so treat Thursday like any powerful local tool: it is not a sandbox. Asking before a login and stopping at Pay are instructions a model follows, not locks. Read [SECURITY.md](SECURITY.md) before giving it access to anything sensitive.

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

**[How it works](docs/how-it-works.md)** · [Contributing](CONTRIBUTING.md) · [Security](SECURITY.md) · [MIT](LICENSE)

If you'd rather say it than type it, [star Thursday](https://github.com/cgoinglove/thursday). Ran it? [Tell me where it stopped](https://github.com/cgoinglove/thursday/issues/new): that list is the roadmap.

</div>
