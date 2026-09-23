---
paths:
  - "features/thursday/**"
  - "features/reach/**"
  - "lib/live/**"
  - "features/ai/live.schema.ts"
  - "features/ai/prompts/live.prompt.ts"
  - "features/ai/prompts/thursday.prompt.ts"
  - "features/ai/prompts/persona.ts"
  - "features/ai/prompts/prompt-helper.ts"
  - "features/ai/prompts/call-standing.ts"
  - "features/ai/tools/call.tool.ts"
  - "app/api/thursday/**"
  - "docs/live-calls.md"
  - "scripts/live-*.test.mts"
  - "scripts/reach*.test.mts"
  - "scripts/text-call.test.mts"
---

# The call

`docs/live-calls.md` is the contract for a spoken call — session events, relays, closing,
persistence — and changes with the code. This file holds what every way into Thursday keeps.

## One Thursday

- **One Thursday on two models.** The Live voice and its Responses backend open with the same
  identity (`thursdayIdentity`), read the same memory, and neither is told it is part of
  something else. Whoever talks to the user reads the persona (`prompts/persona.ts`) and the
  user's own words over it (`styleLines`): the voice on a spoken call, the backend in writing.
- **The voice holds conversation and memory only.** Under `## Always` it reads the guide's
  backchannel and interruption policies, one line on language (the one the user speaks, never
  the browser's) and the delegation policy: what the backend can do, never how, and when to
  hand a turn over. Whether a turn goes to the backend is the voice's decision; the page never
  starts one the voice kept. Ending the call is on the delegation list and in no other rule.
- **One backend, three ways in.** A spoken call (`thursday.action`), the page's call in writing
  (`thursday.text` `streamTextCall`) and a phone (`answerInWriting`) all build
  `loadThursdayPrompt` and `loadTools({ target: "thursday" })`. The `written`, `phone` and
  `readSkills` flags change the prompt and the tool set together; never one without the other.
- **One search, never two**: Exa's function when its key is set, else the hosted or the
  provider's own search.
- **Who she is is the app's; how a machine reaches her is the browser's.** `LiveSettings` —
  voice, persona, their own words, backend model and effort, web search, backend instructions,
  whether she may read a skill — is one row of the `config` table (`THURSDAY_SETTINGS`,
  `readLiveSettings`), read by every way in. The screen sends every field; what is kept is
  what differs from the defaults, so a default nobody picked — a backend model a release
  replaces — moves with the app, as a bot's model left on Automatic does. The browser keeps only this
  machine's own: wake phrase, hotkey, captions, call-back, the write line's model and recipient.

## What she is told

- **A relay carries facts, never instructions** — who, which thread — since the backend reads it
  too. Trusted behaviour goes in as `session.instructions.append`, a bot's words as
  `commentary`, never the reverse.
- **A call is about now.** Earlier calls are reading in the voice's prompt under a heading that
  says they are over — never turns in the conversation, never a line before the greeting. The
  threads standing as a call opens are the backend's alone (`call-standing`, queued with
  `response.item.create`, which starts no turn). What already stood before the call stays on
  the screen (`open-work` `stoodBefore`); only a question, which holds its thread up, is put to her.
- Open work goes in once neither side has been transcribed for `CALL_RELAY.quietMs`, never while
  the backend holds the turn, cut to `CALL_RELAY.chars`, once a call. A relay row is accepted only
  once she has voiced it: Live's acknowledgement says the text arrived, not that anyone heard it.

## A spoken call

- **Voice is GPT-Live, not Realtime.** The server exchanges the browser's SDP through
  `/v1/live/sessions`; the key and the tool manifest stay on the server. The mic stays open for
  the whole call.
- **Tools run on the server, through a route** (`app/api/thursday/tool-call`), because actions
  run one at a time per client. The page's own tools (`end_call`, `emote`) have no `execute`:
  the manifest lists them, the route refuses them by name, and `use-thursday` runs them.
- What the manifest was built from rides back on every tool call (`opened`), so a switch
  flipped mid-call never leaves the model holding tools the route no longer builds.
- **An open call row means someone is listening** — `bot.runner` sends no desktop notice while
  `isAnyCallLive`. Every way in closes its row: a spoken call inserts it only once Live accepts
  and ends it on unmount, reach sweeps idle lines, and the boot sweep spares `heldCalls`.

## A call in writing

- What the write line sends to Thursday is a call in writing (`thursday.text`, `use-text-call`):
  the backend alone, no Live session, its return chapter swapped for an answer to read
  (`writtenAnswer`), its tools less the page's own and plus `look_at`. It is a call row
  (`TEXT_CALL.model`), so history carries it with no table of its own. The page sends the
  conversation whole each turn; the server saves every turn.
- It runs on the model picked on the line, else the GPT Subscription, else the OpenAI key
  (`textCallRunsOn`, one rule for server and screen). A turn that broke is sent again on another
  key only by the button that offers it, never by itself.
- Open work reaches it between turns as a turn of its own, neither drawn nor kept as the user's
  words, once nothing has been written for `TEXT_CALL.quietMs`. That wait is its own: the spoken
  call's `CALL_RELAY.quietMs` is about talking over a voice, and typing is not seen at all. What
  either kind of call has told is one set for the page (`toldWork`).
- During a spoken call the line writes to bots only; a file put down then reaches the call as a
  fact (`screenActs`), never as an instruction.

## A phone (`features/reach`)

- **The server connects out to a chat; it never opens a port.** Each service is one file
  returning `channel.ts`'s `Channel` (Telegram polls, Discord and Slack share `socket.ts`), and
  `reach.ts` never learns which one it talks through. A turn is `answerInWriting`, the
  conversation held by the server and kept as a call row.
- One person per service, let in only from the computer's screen (`reach-ask`): whoever writes
  to her can start work here. Nothing written from a phone goes to a bot directly.
- A bot's question or ending goes as the bot wrote it, never as a turn of hers; she is left the
  fact, stamped by `clockNow`. Work started from a phone comes back to it; anything else only
  while no browser is on the stream (`presence`), and progress never. `told` stops a second
  sending.
- The next turn carries words alone up to the user's last message and everything from there
  (`carried`, `ai/words`), rebuilt as plain messages rather than pruned in place: a reply sent
  without the reasoning item beside it is refused. Past `REACH.messages` the oldest are cut from
  where the user speaks.
- A phone turn has no `thread_show` (`load-tools` `phone`); what she did goes under her answer
  as one line in `tool-line`'s words.
- A page she or a bot names goes with pictures of it (`pictures`), drawn by the renderer the bots
  shoot with (`render.mjs --shot --most`) in a headless session of its own that keeps nothing, so
  that script's options are a contract with the phone. No browser, and the page goes alone.

`pnpm test:live` covers the session and call history; `pnpm test:reach` covers the phone and the
call in writing against stubbed services and a scripted model.
