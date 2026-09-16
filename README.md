<div align="center">

<img src="docs/images/hero.png" alt="Thursday — an open-source voice agent with a face made of emoji" width="760">

### Everyone wanted Friday. This is Thursday.

Talk to your computer. Thursday talks back while bots do the work.<br>
An open-source agent like [OpenClaw](https://github.com/openclaw/openclaw) and [Hermes](https://github.com/NousResearch/hermes-agent), built around your voice and running on your own machine.

[![npm](https://img.shields.io/npm/v/thursday-agent?style=flat-square&color=111&label=npm)](https://www.npmjs.com/package/thursday-agent)
[![CI](https://img.shields.io/github/actions/workflow/status/cgoinglove/thursday/ci.yml?style=flat-square&label=ci)](https://github.com/cgoinglove/thursday/actions/workflows/ci.yml)
[![MIT](https://img.shields.io/badge/license-MIT-111?style=flat-square)](LICENSE)
[![stars](https://img.shields.io/github/stars/cgoinglove/thursday?style=flat-square&color=111)](https://github.com/cgoinglove/thursday/stargazers)

[English](README.md) · [한국어](README.ko.md)

</div>

## Quick start

```bash
npx thursday-agent
```

Paste an OpenAI API key, pick your starter bots, and say **“hey thursday.”**

![The call keeps going while a bot does the work](docs/images/two-minds.png)

## Features

- **Just talk.** A real-time voice call you can interrupt. Start one with “hey thursday” or a hotkey.
- **Bots do the slow work.** Anything that takes more than a few seconds goes to a bot in the background, and the conversation keeps going.
- **Your real computer.** Bots get a shell, your files, and a real browser — even the Chrome you are already signed into. It stops at a Pay button and leaves it to you.
- **Results you can open.** Pages, docs, charts, images, audio, and video, saved as files and opened on your screen.
- **Hang up, it keeps going.** Jobs run on your machine and Thursday tells you when they are done.
- **A team you build.** Make a bot with a name and one sentence. Bots pass work to each other and ask you when a decision is yours.
- **Memory you can read.** What Thursday knows about you is plain notes. Open, edit, or delete any line.
- **Skills and MCP.** Add Agent Skills and connect MCP servers.
- **Any model.** OpenAI, Anthropic, Google, xAI, Vercel AI Gateway, or your ChatGPT sign-in, with a different model per bot.
- **Local-first.** No Thursday account. The app, your data, and your keys stay on your computer.

## Requirements

- Node.js 22.18+
- An OpenAI API key for the voice
- macOS. Linux should work; Windows is not tested yet.

> [!NOTE]
> Bots run real commands on your computer. Thursday is not a sandbox — read [SECURITY.md](SECURITY.md) before giving it access to anything sensitive.

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

If you want an assistant you can talk to while it works, [star Thursday](https://github.com/cgoinglove/thursday).

</div>
