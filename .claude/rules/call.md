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
  same identity (`thursdayIdentity`, the only sentence a helper holds) and read the same memory;
  neither is told it is part of something else. Whoever talks to the user reads the persona
  (`prompts/persona.ts`): the voice on a spoken call, the backend on a call in writing. The
  voice holds conversation and memory only. Right under the persona, `## Always` groups the guide's
  starter backchannel and interruption policies, both as the guide writes them: asking on top of
  them for a listening sound through a long turn made one call in five a bare "응" and chopped
  one of her sentences in seven in half, because the user's own line already asked for it and
  how much of it anyone wants is theirs to say. And the guide's `Delegation policy` under its three labels — `Backend tools`
  (what the backend can do, ending the call first, never how), when to hand a turn over (a hang-up,
  anything on that list, a change to work asked for, whatever they say about themselves) and when
  not (greetings, small talk, only stopping her voice, a brief clarification). Live picks what to
  hand over from that list: without it, hang-ups and stops were answered and never handed over.
  How work is handed over, the threads and tidying memory are the backend's; it merges a fact
  that repeats or changes one already kept, and it asks the user whether work carries an earlier
  thread on or starts a new one only when it could be either. A relay carries facts — who, which thread —
  never instructions, since the backend reads it too.
  **Ending the call is on the delegation list and nowhere else.** Neither prompt carries a rule
  for it any more: the rule above `## Always`, stamped `IMPORTANT` and naming `end_call`, ran the
  tool in 4 of the 7 spoken calls that asked, 2 of them in time (09-20 to 09-21). A name and a
  stamp did not make the voice hand a hang-up over; what does is measured on real calls (todo 31),
  and the tool's own description says what it does.
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
  later call while the page is open (a job that asks or ends again is a new item).
  **A call is about now, and the voice repeats whatever it is given.** What was said on the
  last calls is reading in the voice's prompt, under a heading that says they are over — never
  turns in the conversation, where the hang-up a call ended on was answered as if just said,
  and never a line ahead of the greeting, which opened 15 calls in 15 on old work and 7 on
  "we were cut off". The threads open as a call starts are the backend's alone: queued with
  `response.item.create` (`brief`), which starts no turn and which the voice never reads, so a
  request that carries earlier work on still reaches its thread. And what already stood when
  the call opened — an ending, a progress line — stays on the screen (`stoodBefore`): only a
  question, which holds its thread up, is put to her from before the call, and a call the
  page placed holds nothing back. Updates go in by
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
  last chapter, its memory and the persona, its tools less the page's own (`end_call`, `emote`:
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
  (`reach-ask`): whoever writes to her can start work here. A turn is what they wrote and
  what she answered; work she handed over comes back by itself. It goes as the bot wrote it —
  a line saying whose and which thread, the words with their marks off and their lines kept,
  its files, a question's options as buttons that answer the bot directly — and never as a
  turn of hers, which would spend a whole backend turn repeating what is already written. She
  is left the fact (`Live.notes`), read ahead of what is written next, and it says when in the
  prompt's own clock (`clockNow`): a line can wait a night, and she knows only what time it is now. Where it goes is one
  rule: a thread started from a conversation here comes back to it whoever is watching
  (`listCallJobs` over the calls it was kept as), anything else only while no browser is
  (`presence`), and progress never. Each item is settled the first time it is looked at and
  nothing from before the server came up is news, so neither a browser leaving nor a restart
  sends a backlog, and after a restart nothing is judged until a tab that was open has had
  `BROWSER_GONE_MS` to come back; delivered is seen (`markSeen`), which is what stops a second sending.
  What is written while she works joins that turn between her steps (`answerInWriting`
  `notes`, as `bot.run` takes a bot's), since a chat cannot stop anyone writing twice, and
  what comes after her last step gets the next turn. The conversation outlives `REACH.idleMs`
  while a thread it started is running. What goes with the next turn is words alone up to
  the last thing they wrote and whole from there (`carried`, `ai/words`): tool results and her thoughts
  are most of a turn's weight and every turn sends all of it again. They are rebuilt as
  plain messages, not pruned in place — her text keeps the provider's item id, and sent
  without the thought beside it the provider refuses the conversation — and past
  `REACH.messages` the oldest are cut deep (`trimTo`), from where the user speaks, so no tool
  call loses its result and the prompt cache holds between cuts. Nothing written from a
  phone goes to a bot directly: whose a reply is would have to be guessed, per service. A
  turn held for a phone has no `thread_show` (`load-tools` `phone`, and the prompt's
  sentence with it): no screen of theirs is in front of them, so what they ask to see goes
  as the files her answer names. What she did goes under her answer as one line in
  `tool-line`'s words, since a chat has no activity line. Her
  settings live in the browser, so a phone runs on the defaults. `pnpm test:reach` runs the
  core against a stubbed service, the two socket channels against a stubbed socket, and a
  held turn against a scripted model.
