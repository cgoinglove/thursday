# How it works

The README says what Thursday is. This says what each part may touch, so you can guess what will happen before you say it.

## The call

A call is a session with a realtime speech model — OpenAI Realtime or xAI Grok Voice, whichever key you gave. Audio in, audio out, interruptions and all. The model hears a prompt assembled the moment the line opens: who she is, what she remembers about you, which bots exist, what was said on the last calls.

She holds three things and nothing else:

- **Memory.** A folder of notes about you. She reads a note before answering out of it and writes the moment something worth keeping comes up — one fact per line, dates as dates. A rule you lay down ("answer in Korean", "keep it short") is carried into every call.
- **One command.** A shell, for the things that take a second: open a file, play something, look at what is in a folder. One command is something she does, not a job she hands over.
- **The roster.** The bots, by name, and what each is for.

Everything else — anything that takes more than a few seconds — she hands to a bot with `delegate` and keeps talking. That is deliberate: the call must never go silent, and a speech model that runs a browser would be silent for minutes.

When a job comes back, it arrives as a system note, not as you speaking. She tells you in one sentence, in her own words. A file the job made opens on your screen by itself; a question the job asks becomes buttons on screen and words in your ear.

## Bots

A bot is a text model — any of OpenAI, Anthropic, Google, xAI, or whatever the Vercel AI Gateway carries — with the whole machine:

- a **shell** in a workspace folder, with no pager and no secrets in its environment
- a **real browser** (Chromium through Playwright), headless until a sign-in or something you should see, and able to attach to the Chrome you already use
- the **filesystem**, read anywhere, written only inside the workspace and where you pointed it
- **skills** — written-down methods it reads before starting: the browser, this Mac, building a page, finding and writing skills
- **MCP servers** you connected, searched by name and called by schema, with OAuth handled
- a **studio** of image, video, speech and transcription models
- **each other**: a bot hands a part of its job to the bot that exists for it, and folds the answer into its own report

A job ends in the thing that was asked for — the account made, the page built, the comparison in a table — and a report, written to be heard, because she reads it out loud. Anything that does not fit in a few lines is a file under `artifacts/`, and the report names it.

What only you can give — a password, a one-time code, a passkey, a decision between two real options — stops the job at that point. The bot sets it up one action away, asks, and continues when the answer comes.

Three bots come with the app, split by temperament: **Jarvis** plans a job, hands parts to whoever fits and does the rest; **Navigator** goes and looks; **Scribe** writes. Make more in settings: a name, a sentence about what it is for, optionally a model and a few pinned tools. The sentence is what she reads when deciding who gets the job.

## Jobs outlive the call

A job runs on the server. It is not in the tab, and it does not stop when you hang up. Every step — the request, each tool call, what came back, the report — is written as a row, and the screen is a projection of those rows. When you come back, the jobs that finished are waiting, and she tells you about them on the next call, or rings you if you turned that on.

A job that stopped to ask, or ran out of its step budget, is resumed from where it stopped: the same thread, with your answer appended. A long thread is compacted — the model summarizes what happened so far and continues from the summary.

## Memory is a folder

Memory is plain notes on your disk, in the data folder (`~/.thursday` when installed with `npx`, the checkout otherwise). Each note is a topic — `profile`, `preferences`, `people/…`, and whatever she creates. A few are `alwaysLoad` and travel into every call: your name, your language, how you like to be addressed, the rules you gave her.

You can open any note from settings and read exactly what she knows. When the listing gets long she says so in a lull, puts a note on your screen and forgets only what you name.

Writing mid-conversation catches what she noticed; it misses what only reads back as important afterwards. So when a call ends, a text model re-reads the most recent turns and reconciles the notes with them — correcting what changed, adding what was said in passing. Calls are stamped as they are read, so a backlog of short calls collapses into one pass rather than one per call.

Bots read memory but do not write it. What a bot learns goes into its report; whether it is worth keeping is her call, with you.

## What is not here

- **No cloud.** The server is the one on your machine; keys are stored locally and sent only to the provider you chose.
- **No account.** There is nothing to sign up for. There is also no login, which is why the server binds to `127.0.0.1` — see [SECURITY.md](../SECURITY.md).
- **No prompt engineering on your side.** The prompts are assembled from your data on every session; the one thing you can add is an instruction to her, and one to each bot, in settings.

For the code — which file owns what, and why — read [CLAUDE.md](../CLAUDE.md).
