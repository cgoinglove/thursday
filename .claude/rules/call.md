---
paths:
  - "features/thursday/**"
  - "features/reach/**"
  - "lib/live/**"
  - "features/ai/prompts/live.prompt.ts"
  - "features/ai/prompts/thursday.prompt.ts"
  - "features/ai/prompts/call-*.ts"
  - "features/ai/tools/call.tool.ts"
  - "app/api/thursday/**"
  - "docs/live-calls.md"
---

# The call

- **The call is one Thursday on two models.** The Live voice and its Responses backend open with the
  same identity (`thursdayIdentity`, the only sentence a helper holds), each followed by its own
  rule for ending the call — the voice says yes and hands the turn over at once, the backend runs
  `end_call` without deliberating, since only it can end the line — and read the same memory; neither
  is told it is part of something else. The voice holds conversation and memory only. Right under
  its identity, `## Always` groups the ending rule (the only line stamped `IMPORTANT`), the guide's
  starter backchannel and interruption policies (the backchannel line asking for listening sounds
  through a long turn), and the guide's `Delegation policy` under its three labels — `Backend tools`
  (what the backend can do, ending the call first, never how), when to hand a turn over (a hang-up,
  anything on that list, a change to work asked for, whatever they say about themselves) and when
  not (greetings, small talk, only stopping her voice, a brief clarification). Live picks what to
  hand over from that list: without it, hang-ups and stops were answered and never handed over.
  How work is handed over, tidying memory and earlier calls are the backend's; it merges a fact
  that repeats or changes one already kept, and it asks the user whether work carries an earlier
  thread on or starts a new one only when it could be either. A relay carries facts — who, which thread —
  never instructions, since the backend reads it too.
- **Tools run on the server.** A call's tool invocation is forwarded by the page to the server, so
  tools call domain queries directly. The one exception is anything that touches the call itself
  (hang up, a word on her face).
- **Voice is GPT-Live, not Realtime.** The server exchanges the browser's SDP through
  `/v1/live/sessions`; the API key, both prompts and the tool manifest stay on the server. Live
  speech and Responses work have independent lifecycles. Collect function calls from nested
  `response.output_item.done`, return all outputs, then explicitly continue the backend. The mic
  stays open for the whole call; nothing the page does closes it.
  Live never speaks unprompted: every call opens with an instruction to speak first, and open
  work (unseen endings and stops, unanswered questions) goes in when neither side has been
  transcribed for `CALL_RELAY.quietMs` (on a call the page placed for it, once she has said so),
  each item once a call and, once she has voiced it, not on a
  later call while the page is open (a job that asks or ends again is a new item). Updates go in by
  kind — trusted behaviour as
  `session.instructions.append`, bot output as `commentary`, never the reverse — nothing goes in
  while the backend holds the turn, a bot's message goes in cut to what can be said aloud
  (`CALL_RELAY.chars`), and a relay row is accepted only once she has voiced it: Live's
  acknowledgement says the text arrived, not that anyone heard it. Transcript fragments have timestamps, not final
  turns: caption groups remain revisable and are saved with their fragments. Close with
  `session.close` and wait for `session.closed` before releasing transport resources, with a
  bounded timeout. The full contract is `docs/live-calls.md`. Whether a turn goes to the
  backend is the voice's own decision; the page never starts one the voice kept.
- **A call in writing.** The write line opens on Thursday, and what is sent to her is a call in
  writing (`thursday.text`, `use-text-call`): the call's backend alone — its prompt but for the
  ending rule and the last chapter, its memory, its tools less the page's own (`end_call`, `emote`:
  there is no line to drop), no Live session — drawn by the same call screen and kept as a call
  row (`TEXT_CALL.model` where a spoken one names Live), so Earlier calls and the call log carry
  it with no table of their own. The page holds the conversation and sends it whole each turn;
  the server saves every turn as it happens. It runs on the model picked on the line itself
  (the `runs on` button, any provider with a key, remembered by the browser and sent with each
  turn — never a setting, so it is not taken for the spoken call's backend model), else on the
  GPT Subscription when one is signed in, else the OpenAI key (`textCallRunsOn`, one rule for
  the server and the screen) — a rule about what is set, never a second try after a refusal:
  a turn that broke is sent again on the OpenAI key only by the button that offers it. Open work reaches it as it reaches a spoken call — the same list
  (`open-work`), between turns once nothing has been written for `CALL_RELAY.quietMs`, as a
  turn of its own that is neither drawn nor kept as the user's words, its relay rows accepted
  once she has answered — and nothing rings meanwhile; what either kind of call has told is
  one set for the page (`toldWork`), so neither repeats the other. A bot can still be picked
  in the line during it, for one message. Esc or a spoken call ends it; a spoken
  call has the line to itself, so what is typed then goes to a bot, and a file put down then
  reaches the call as a fact the way a screen answer does (`screenActs`), never as an
  instruction.
- **A phone reaches her through a chat the server connects out to, never a port.** `reach`
  listens to the user's own bot on Telegram (a long poll), Discord or Slack (a socket the app
  opens, `socket.ts`) — each service is one file returning `channel.ts`'s `Channel`, and
  `reach.ts` never learns which it talks through — and answers with
  `thursday.text` `answerInWriting`: the run a page's call in writing streams, answered whole,
  with the conversation held by the server instead of a page and kept as the same call row. One
  person may write through each service, and only the computer's screen lets them in
  (`reach-ask`): whoever writes to her can start work here. Open work goes to the service they
  last wrote from, once the computer has had
  `REACH.notifyAfterMs` to tell it — as a turn of that conversation that is not the user's, its
  relay rows accepted once she has answered, a question's options as buttons that answer the bot
  directly — and progress never does. Her settings live in the browser, so a phone runs on the
  defaults. `pnpm test:reach` runs the core against a stubbed service and the two socket
  channels against a stubbed socket.
