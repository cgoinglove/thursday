---
checked: 2026-09-25
paths:
  - "features/thursday/components/**"
  - "features/thursday/{tool-line,face*,field,smoke,eyes,wash,ascii.const,silent-voice}.*"
  - "features/bot/components/{room-*,bot-room,bot-tool,bot-mark,bot-tip,thread-reply,attachments,crew-motion,write-orb}.*"
  - "features/bot/{thread.store,mark.const,mark.geometry}.ts"
  - "features/workspace/components/{artifact-view,file-thumb,file-view,given-files}.tsx"
  - "features/intro/**"
  - "app/page.tsx"
  - "scripts/intro-voice.mts"
---

# The call screen and the faces

The app is one screen: her face in the middle, and at a glance who is working, what waits on the
user and what has finished.

## Start here
- `features/thursday/components/thursday.tsx` — the call screen: her face, her line, the captions, and `CallFoot` (the rail and the row above it).
- `features/bot/components/bot-room.tsx` — the room: the pill while folded (`room-pill.tsx`), the list or one thread while open.
- `features/bot/components/room-conversation.tsx` — a thread read as a conversation; `thread-reply.tsx` beside it is its box, its questions and Stop.
- `features/bot/thread.store.ts` — the client mirror of threads, and the signals the screen's parts send each other.
- `features/thursday/tool-line.ts` — the line for each of the call's tool calls; `features/bot/components/bot-tool.tsx` draws a bot's steps.
- `features/workspace/components/artifact-view.tsx` — the left corner of finished jobs; `file-thumb.tsx` and `file-view.tsx` beside it draw and open a file.
- `features/thursday/components/face.tsx` — her face, the call's status mapped onto `ascii-orb.tsx`; a bot's face is `features/bot/components/bot-mark.tsx`, its shape `features/bot/mark.geometry.ts` (no React: the tab's icon and the face a bot's pages carry, `markStill`).
- `features/intro/components/intro.tsx` — the first run, drawn over the call screen; `features/intro/intro-voice.ts` holds what she says aloud there.
- `features/intro/components/echoes.tsx` — the first run's opening: her larger sizes stepping down to her own on the intro's face box, before her real face comes in `waking`.

## How it fits
`use-thursday` (a spoken call) and `use-text-call` (a call in writing) hold the call's state, and
`thursday.tsx` draws either. Jobs reach the screen as server rows: `use-thursday` reads
`queryKey.threads` and syncs it into `thread.store`, the pill, the room and the left corner all
read that one mirror, and the room's list and counts go through `bot.schema` `standOf`. The parts
reach each other through `thread.store` signals (`roomOpen`, `writeLine`, `roomOpens`) rather than
props, and the call hears what the user did on screen through `screenActs`. `tool-line` is not the
screen's alone: the call log and a phone chat show its words, a phone call's older tool calls
reach the model as those words (reach `carried`), and the call prompts read stored turns back
through its `searchOf` and `startedLabel`.

## Rules
- How anything here looks or moves changes as its own proposal, never on the way to other work — a look changed in passing is one nobody chose.
- Anything new at the foot takes a cell of `CallFoot`'s grid, on the rail or in the row above it, never a position against the window or a breakpoint — placed any other way, at some width it lands on the pill, the cards or the write line.
- A bot's mark is seeded by the bot's name and wears its whole `icon` wherever it is drawn — a mark seeded or coloured from anything else reads as a different bot.
- A line changed in `intro-voice.ts` `INTRO_SPOKEN` is recorded again with `scripts/intro-voice.mts`, and the clips it writes under `public/voices/intro/` go in the same commit — a clip left for later is silence on every first run, and nothing reports it.

## Check
Nothing tests the drawing; `pnpm test:bot` covers `thread.store`'s drafts and `pnpm test:live` the
pages `tool-line` reads off a search. Look at it on a scratch server (AGENTS.md, Running
the app). `/?intro` brings the first run back. A room with jobs needs a bot run on real keys; to see a
state without one, intercept `/api/bot/thread` in the browser and answer with edited JSON.
