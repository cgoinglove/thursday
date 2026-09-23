---
checked: 2026-09-24
paths:
  - "features/thursday/thursday.*.ts"
  - "features/thursday/use-*.ts"
  - "features/thursday/{open-work,tool-call,call-signal}.ts"
  - "hooks/use-wake-word.ts"
  - "features/reach/**"
  - "lib/live/**"
  - "app/api/{thursday,reach}/**"
  - "features/ai/live.schema.ts"
  - "features/ai/prompts/{live,thursday}.prompt.ts"
  - "features/ai/prompts/{call-standing,persona}.ts"
  - "features/ai/tools/call.tool.ts"
  - "scripts/{live-*,reach*,text-call}.test.mts"
---

# The call

The user talks to one Thursday — aloud, in writing on the call screen, or from a phone chat — and
she answers what takes a glance on the spot and hands anything longer to a bot.

## Start here
- `features/thursday/use-thursday.ts` — a spoken call in the page: the Live session, relays, the page's own tools, hanging up.
- `features/thursday/thursday.action.ts` — opens a call on the server (SDP exchange, both prompts, the tool manifest) and saves its rows.
- `lib/live/live.session.ts` — the GPT-Live wire: session events, appends, the backend's tool loop.
- `features/thursday/thursday.text.ts` — a call in writing, for the page and for a phone.
- `features/ai/prompts/live.prompt.ts` — what the voice hears: persona, `## Always`, the delegation list.
- `features/ai/prompts/thursday.prompt.ts` — what the backend hears, on every way in.
- `features/thursday/open-work.ts` — background work as a call is told about it.
- `features/reach/reach.ts` — Thursday from a phone chat.

## How it fits
A spoken call is two models on one Live connection: `openCallAction` builds the voice's prompt,
the backend's prompt and the tool manifest on the server, and the backend's tool calls arrive in
the page and run through `/api/thursday/tool-call`, but for `end_call` and `emote`, which
`use-thursday` runs. A call in writing (`use-text-call` → `/api/thursday/text`) and a phone
(`reach.ts` → `answerInWriting`) are that backend with no voice, run by `thursday.text`. Every way
in reads the one `LiveSettings` row (`readLiveSettings`) and is kept as a call row that the next
call's prompts read back; the browser's `thursday.store` holds only how this machine reaches her.
Background work reaches a call through `open-work` (what waits on the user, as it comes) and
`call-standing` (what stood open as the call began, for the backend alone).

## Rules
- Voice is GPT-Live (`/v1/live/sessions` in `lib/live/live.server.ts`, tools delegated to a Responses backend), not the Realtime API — code written from memory of Realtime does not match this wire.
- A switch that changes her tool set reaches `loadTools`, `loadThursdayPrompt` where the prompt names those tools, and on a spoken call `CallHandshake.opened` and the tool-call route's schema, which drops a field it does not name — else she is told of a tool she lacks, or the route builds a set other than her manifest.
- A new kind of thing the call can do gets a line on the voice's delegation list (`live.prompt` `delegation`) — without it the voice answers the request herself and never hands it over.
- What reaches her that the user did not say — a bot's words, an act on screen, a press on a phone — goes in as a fact (who, which thread, what happened), on a spoken call as `commentary` or `thinking` and never as `instructions` — else a bot's text steers her as if the app had said it.
- A new way into a call ends its row wherever that call ends, and a row the server holds rather than a tab is listed by `heldCalls` — an open row keeps `isAnyCallLive` true, so `bot.runner` sends no desktop notice, and an unlisted held row is swept shut when the last tab goes.
- Every `Incoming` kind a channel hands over passes `take`'s check of the one person let in before it reaches her or a bot — whoever gets past it runs commands on this computer through her.

## Check
`pnpm test:live` (the Live wire, both call prompts, call history) and `pnpm test:reach` (a phone
against stubbed services, a call in writing on a scripted model, the settings row). To hear a
call, place one on a scratch server (AGENTS.md, Running the app); it needs a microphone and bills
the OpenAI key.
