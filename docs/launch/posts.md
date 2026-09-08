# Posts

Copy for every channel in the [runbook](README.md). Each is written for where it goes — the same story, never the same text. Edit freely; the bot posts what is here, after you have looked.

---

## Demo

Script for the 60-second take. One call, real voice, no cuts inside the call.

1. Screen shows the idle call screen. Say: **"Hey Thursday."** Wait for her.
2. **"I'm going to Kyoto next week. Find me a coat under two hundred dollars and put the options on one page."**
3. She answers in one line ("On it — Navigator went to look"). The pill appears under the mark.
4. Keep going, unrelated: **"Also, remember my sister's birthday is March third."** She confirms.
5. Let 15–20 seconds pass; the job line shows tool chips as the bot works. Say nothing, or ask what's in your Downloads folder.
6. The page opens by itself. She says it's back.
7. **"Thanks. Hang up."** End.

Cut the GIF from step 3 to step 6. Full take to YouTube, unlisted until launch.

---

## Release notes

Title: `v0.1.0 — the first one you can install`

> Thursday is a voice agent that runs on your own machine. You talk; a realtime speech model holds the call and hands anything slow to text-model bots with a shell, a real browser and skills. Jobs keep running after you hang up.
>
> **Install**
> ```
> npx thursday-agent
> ```
> One OpenAI or xAI key, typed into the first screen. No `.env`.
>
> **What's in it**
> - The call: OpenAI Realtime and xAI Grok Voice, any language, interruptions
> - Three bots — Jarvis, Navigator, Scribe — and your own in a minute
> - Skills: browser, this Mac, interactive pages, and `npx skills add` for the rest
> - MCP servers with OAuth; pin tools to a bot
> - A studio: image, video, speech, transcription
> - Memory as notes on your disk, readable in the app
>
> **Known rough edges**
> - Built on macOS. Linux should work; Windows is untested.
> - The Mac skill needs `peekaboo` (brew) and two permissions.
> - A first `npx` boot fetches Chromium (~280 MB) in the background.
>
> Say something to her and tell me where it stopped: that is the roadmap.

---

## Hacker News

**Title** (≤ 80 chars):

`Show HN: Thursday – a voice agent on your machine that hands slow work to bots`

**URL**: `https://github.com/cgoing/thursday`

**Maker comment** — post it within a minute of the submission:

> I built this because every agent I tried was a text box, and I wanted to *talk* to my computer while it did things — and keep talking while it was still doing them.
>
> The trick is that there are two kinds of mind on the line. A realtime speech model (OpenAI Realtime or xAI Grok Voice) holds the conversation and is only allowed to touch what it can answer in a glance: what it remembers about you, one file, one shell command. Anything longer — a browser, a service, a minute-long job — it hands to a text-model bot with a `delegate` call and keeps talking. The bot has the whole machine: shell, Playwright browser, files, skills, MCP servers, and the other bots. When it's done, the result comes back as a system note and she says it in one sentence.
>
> Jobs run on the server, not in the tab, so they don't stop when you hang up. Memory is a folder of plain notes on your disk.
>
> It's `npx thursday-agent`, one API key, no `.env`. MIT.
>
> What's rough: I built it on macOS and haven't tested Windows. The Mac-control skill needs a brew install. And the speech models are still expensive per minute, which is the real limit on "talk to it all day."
>
> The thing I'd most like to hear: what you said to it, and where it stopped.

**Replies to expect**, with the honest answer:

- *"Why voice, text is faster?"* — It is. This is for the times your hands or eyes are busy, and for people who can't type. And for the feeling of something running while you keep talking — that part doesn't exist in a text box.
- *"Is it safe to give an LLM a shell?"* — It's the product; see SECURITY.md. Keys never reach the shell env, writes are fenced to a workspace, server is localhost only, passwords are yours. It is not a sandbox and the README says so.
- *"Cost?"* — Realtime is per-minute and not cheap; bots are per-token on whatever model you pick. One key runs everything; a cheap bot model is fine.
- *"Local models?"* — Not yet for voice (no local realtime speech model worth using). Bots can run on anything the Vercel AI Gateway carries; a local endpoint is an issue away.

---

## X

Thread. Tweet 1 carries the video.

1. I made a voice agent that runs on your own machine.
   You talk. It hands the slow stuff to bots with a shell and a real browser — and keeps talking while they work.
   `npx thursday-agent`
   *(video)*

2. The idea: two kinds of mind on one call.
   A realtime speech model holds the conversation and only touches what it can answer in a glance.
   Everything else goes to a text-model bot that runs in the background.

3. Bots have the whole machine — shell, Playwright browser, files, skills, MCP — and each other.
   They sign in where they must, in a window you can see, and stop only for what's yours: a password, a code.
   *(image: bots artboard)*

4. Hang up. The job keeps running. She tells you next call — or rings you, if you let her.
   *(image: one-job artboard)*

5. Memory is a folder of notes on your disk. One fact per line. You can open every one.

6. MIT, one API key, no `.env`.
   github.com/cgoing/thursday
   Tell me what you said to it and where it stopped.

---

## Reddit

Three subreddits, three posts. Same repo, different reason to care.

### r/LocalLLaMA

**Title**: `Thursday: a voice agent that runs locally and delegates to text-model bots with a shell and a browser (MIT, npx)`

> Not a local model post — the voice side needs OpenAI Realtime or xAI right now, there's no local realtime speech model I'd put a call on. But everything else is yours: it runs on your machine, keys stay in a local SQLite, memory is plain notes on disk, and the bots that do the actual work can run on anything the Vercel AI Gateway carries (a local endpoint is the next thing I'd add if people want it).
>
> The architecture is the interesting part: the speech model is only allowed to touch what it can answer in a glance, and hands everything else to a text model with `delegate`. That's what keeps the call from going silent while a browser job runs for a minute.
>
> `npx thursday-agent` · github.com/cgoing/thursday

### r/selfhosted

**Title**: `Thursday — self-hosted voice agent: npx, localhost only, no cloud, no account`

> One command, one API key, and it's on 127.0.0.1. There is no signup and no server of mine anywhere — the "server" is the Node process on your machine; the only outbound traffic is to the model provider you chose.
>
> What it does: you talk to it; it hands slow work (browsing, shell, connected services) to background bots that keep running after you hang up. Memory is a folder of notes. MCP servers connect with OAuth.
>
> What it isn't: multi-user. There's no auth, because there's no second user. Don't bind it to 0.0.0.0.
>
> github.com/cgoing/thursday

### r/artificial

**Title**: `I built a voice assistant that hands off work to background agents and keeps talking — open source`

> The thing text-chat agents can't do: keep the conversation going while the work happens. This one can, because the voice model never does the work — it delegates to text-model bots with a shell and a real browser, and tells you in one sentence when they're back.
>
> 60-second demo in the README. `npx thursday-agent`, MIT.

---

## Product Hunt

**Name**: Thursday
**Tagline** (≤ 60): `A voice agent on your machine. Talk; bots do the slow work.`
**Topics**: Artificial Intelligence, Developer Tools, Open Source, Productivity

**Description**:

> Thursday is a call, not a chat. You say what you want, in your own words, and keep talking — a realtime speech model holds the conversation while text-model bots with a shell, a real browser and skills do the work in the background. Jobs keep running after you hang up; she tells you when they're back.
>
> Runs on your own machine. One API key. No account, no cloud, no `.env`. Memory is notes on your disk. MIT.

**First comment** (maker):

> Hi PH — I'm the one who built this. I wanted an assistant I could *talk to while it worked*, not a box I type into and wait. The way it works: the voice model is only allowed to do what takes a second, and hands everything else to bots that have the whole machine. That one rule is most of the product.
>
> It's early — built on a Mac, three bots in the box, the Mac-control skill needs a brew install. Say something to it and tell me where it stopped; that's what I'll build next.

---

## Korean

### GeekNews (news.hada.io)

**제목**: `Thursday – 내 컴퓨터에서 도는 음성 에이전트, 느린 일은 봇에게 넘기고 계속 대화`

**요약**:

> - 실시간 음성 모델(OpenAI Realtime / xAI Grok Voice)이 통화를 잡고, 한눈에 답할 수 있는 것만 직접 처리
> - 브라우저·셸·연결 서비스처럼 오래 걸리는 일은 텍스트 모델 봇에게 `delegate` — 봇은 셸, Playwright 브라우저, 파일, 스킬, MCP 서버를 가짐
> - 작업은 서버에서 돌아서 전화를 끊어도 계속됨. 끝나면 한 문장으로 말해줌
> - 메모리는 디스크의 노트 폴더. 키는 로컬 SQLite. 서버는 localhost 만
> - `npx thursday-agent`, 키 하나, `.env` 없음. MIT
> - better-chatbot(1.1k★) 만든 사람의 다음 프로젝트. 이번엔 음성

### Disquiet

**제목**: `말로 시키고 계속 얘기하면, 뒤에서 봇들이 일을 끝내놓는 음성 에이전트를 만들었습니다`

> 텍스트 에이전트를 쓰면서 제일 답답했던 건 "기다리는 시간"이었어요. 브라우저 켜서 뭘 찾는 동안 채팅창을 보고 있어야 하잖아요. Thursday 는 통화예요. 말로 시키면 "네, 보러 갔어요" 하고 대화가 계속되고, 그 뒤에서 봇이 진짜 브라우저를 열어서 일을 합니다. 끝나면 한 문장으로 알려주고, 만든 페이지는 화면에 저절로 열려요.
>
> 핵심은 규칙 하나예요. 음성 모델은 1초 안에 되는 것만 직접 하고, 나머지는 전부 텍스트 모델 봇에게 넘긴다. 이게 통화가 조용해지지 않게 하는 방법이었습니다.
>
> 내 컴퓨터에서 돌고, 키 하나면 되고, 계정도 클라우드도 없어요. `npx thursday-agent` 한 줄. MIT.
>
> 뭐라고 말했고 어디서 멈췄는지 알려주시면 그게 다음 로드맵입니다.
> github.com/cgoing/thursday

### X (한국어)

> 내 컴퓨터에서 도는 음성 에이전트를 만들었어요.
> 말로 시키고 계속 얘기하면, 뒤에서 봇들이 브라우저 열고 셸 돌려서 일을 끝내놓습니다. 끊어도 계속 돌아요.
> `npx thursday-agent` 한 줄, 키 하나, MIT.
> *(영상)*

---

## Newsletters

Submission forms, one paragraph each. Same facts, their length limit.

**TLDR AI** (tldr.tech/ai → submit): `Thursday is an open-source voice agent that runs on your machine: a realtime speech model holds the call and delegates slow work to text-model bots with a shell and a real browser, which keep running after you hang up. npx, one key, MIT.`

**Ben's Bites** (bensbites.co → submit a tool): same paragraph.

**Console.dev** (console.dev/submit): `Voice agent for your own machine. Talk to it; it delegates browser/shell/MCP work to background bots and keeps the conversation going. npx thursday-agent. MIT, Node, Next.js, Playwright.`

**The Rundown** (therundown.ai → submit): same as TLDR.

---

## Article

For Dev.to / Hashnode, launch + 7. Outline; the bot drafts the full text from CLAUDE.md and docs/how-it-works.md.

**Title**: *Why a voice agent needs two kinds of mind*

1. The problem nobody mentions: a voice model that runs a browser goes silent for a minute, and a silent call is a dead call.
2. The rule: the speech model may only touch what it can answer in a glance. Everything else is a job.
3. What a job is: a text model with the whole machine, a step budget, a report written to be *heard*.
4. Jobs outlive the call — why the server holds them and the screen is a projection.
5. Memory as notes: why plain files, why one fact per line, why she writes without asking.
6. What it cost: realtime pricing, and what I'd change.
7. What's next: desktop app, local voice when it exists.

---

## Awesome lists

One-liners in each list's own format. The bot opens the PRs.

- **awesome-ai-agents**: `Thursday – Voice agent for your own machine; a realtime speech model delegates to background bots with a shell, a browser and skills. MIT.`
- **awesome-mcp-clients**: `Thursday – Local voice agent; bots connect to MCP servers with OAuth, search tools by name and pin them. MIT.`
- **Vercel AI SDK showcase**: `Thursday – Voice agent built on the AI SDK: realtime call plus text-model bots across every gateway provider.`
