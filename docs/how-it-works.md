# How it works

What each part does, so you can guess what will happen before you say it.

## The call

A call runs on two models: **GPT-Live 1** holds the conversation, and a Responses model (**GPT-5.6 Luna** by default) thinks and uses tools behind it. The voice keeps listening while the backend works.

![One mind goes silent while it works; two minds keep the call going while a bot does the work](images/two-minds.png)

- **Quick things, she answers herself.** She reads and writes your memory and runs one shell command at a time: open a file, check a folder, play something.
- **Everything else goes to a bot.** She hands it over and keeps talking. A speech model that ran a browser itself would go silent for minutes.
- **When a job comes back,** she tells you in a sentence. A file it made shows up in the corner of your screen, and a question it asks shows up as buttons.

Settings › Thursday picks the voice, the backend model and its reasoning, web search, the wake word and hotkey, and whether she calls you when a job ends.

The voice is billed per active minute, silence included; the backend is billed per token. Both use your OpenAI API key, not a ChatGPT subscription.

## Bots

![A bot gets a shell, a real browser, skills, MCP servers, a studio and its own memory](images/machine.png)

A bot is a text model from any provider you added, with:

- a **shell** in a workspace folder
- a **real browser** — its own, or the Chrome you already use
- **your files** — it reads anywhere and writes where your user can; only its file tool is kept out of the app and the workspace root ([SECURITY.md](../SECURITY.md))
- **skills**, methods it reads before it starts
- **MCP servers** you connected
- a **studio** for images, video, speech, and transcription
- **each other**, to hand off part of a job

The first run lets you pick a few starter bots; more are ready in Settings › Bots, or make your own with a name and one sentence about what it is for. That sentence is how Thursday decides who gets a job. Switch a bot off without deleting it.

A job ends in the thing you asked for and a short report. Anything longer than a few lines is a file in `artifacts/`. When only you can do something — sign in, choose between two real options — the bot sets it up, asks, and waits. It never presses Pay: a purchase stops on the last screen, left open for you.

Each bot keeps its own memory as files you can open from its page.

## Jobs outlive the call

![Hang up mid-sentence and the job keeps going on the server](images/keeps-going.png)

- A job runs on the local server, not in the call. Hang up and it keeps going.
- Every step is saved, so a job that stopped to ask picks up where it left off, and you can read the whole thread.
- Close the app, and after ten seconds running jobs pause. Open it again and they continue, so nothing spends your keys while you are away. Settings › Bots keeps them running instead, if you would rather they finish with nothing open.
- A model call that fails is retried once. After that, the job waits for you.

## Memory

Memory is a set of notes about you, one fact per line: your name, your language, the people you mention, the rules you give her. A few notes go into every call.

Open any note in Settings › Memory to see exactly what she knows. To change it, type what changed and watch each edit land. Bots read your memory but never write it.

## Where your data lives

```text
~/.thursday
├── local.db          calls, memory, bots, jobs, keys
└── .ai-workspace
    ├── artifacts/    finished work, a folder per bot
    ├── projects/     code and longer-lived projects
    ├── bots/         each bot's memory and saved sessions
    └── .agents/      skills you installed
```

When you run from source, the same files live in the checkout. The server listens only on `127.0.0.1`, and there is no login — see [SECURITY.md](../SECURITY.md).

For contributors: [live calls](live-calls.md) and [thread rooms](thread-rooms.md) are the engine contracts, and [AGENTS.md](../AGENTS.md) maps the code.
