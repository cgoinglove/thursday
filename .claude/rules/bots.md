---
paths:
  - "features/bot/**"
  - "features/routine/**"
  - "features/workspace/**"
  - "features/signins/**"
  - "features/ai/tools/bot.tool.ts"
  - "features/ai/tools/signin.tool.ts"
  - "features/ai/prompts/bot.prompt.ts"
  - "app/api/events/**"
  - "instrumentation*.ts"
  - "skills/**"
  - "seed-skills/**"
---

# Bots, threads and the jobs they run

- **Long-running work is the server's, not the request's.** A job's run is a promise the server holds
  (`bot.runner` `launch`), never `after()`: messages and returning browsers also start runs
  outside a request. Everything that happens is written as rows, so what the screen draws and
  what the model re-reads are the same rows.
- **One participant per bot per thread.** A bot resumes its own stored transcript across requests,
  including requests from different callers. `parent` names the current exchange, not the bot's
  identity. Browser sessions use the thread and canonical bot name, and the workspace is marked
  as the browser CLI's own (`.playwright`), so what those sessions keep on disk is this app's
  alone: a cancel closes the windows, a removed or aged-out thread takes its profiles with it.
  Requests to the same bot run sequentially. Messages are asynchronous: a waiting A can handle a question from B in its own
  context, but a bot waiting on the user's answer runs nothing until it arrives; its inbox holds. Only exchanged messages cross participant contexts. `room.query` owns durable inboxes,
  continuation claims and return routes; `bot.runner` owns live promises.
- **A sign-in is the app's to keep and the user's to lend.** A bot borrows one with
  `sign_in_use` and hands over the one the user just made with `sign_in_keep`
  (`tools/signin.tool`); the session lives under `DATA_DIR/.sign-ins`, one file a site, outside
  the workspace, and crosses it only as a file that exists for one browser-CLI command. That is
  a place, not a lock — a bot's shell is not confined — and what it buys is that no bot comes
  across another's session among its files. Which bots may borrow is settled on screen only
  (Settings › Sign-ins, or the button a waiting bot's question carries,
  `signin-ask`): a refused borrow is noted as `asking`, and nothing a tool is told lets a bot
  in. Boot takes in what bots used to keep under `bots/<name>/.auth`.
- **No browser, nothing runs — unless the user said otherwise.** `presence` (app/api/events) says
  whether a browser is on the stream; when the last one has been gone a while, jobs stop and wait
  and open calls close. When one comes back, only jobs paused for browser absence pick themselves
  back up. One switch changes it (`KEEP_WORKING_KEY`, Settings › Bots, off by default): work then
  runs on with nothing open and only the server stopping parks it, while the open calls still
  close with their tab. Both readers — boot's `onGone` and the room pump — ask the same key. A model call that breaks
  is tried once more (`BOT_RUN.retryMs`); a second break, a provider's refusal, a server restart,
  a resource limit or a user stop waits for a person. Wired once at boot (`instrumentation`),
  not in each domain.
- **A routine only opens threads.** `routine.clock` looks for what is due and calls `startThread`;
  everything after that — questions, stops, the relay into a call — is the thread's, and nothing in
  the room engine knows a routine exists. A run carries `thread.routine_id`, and how a routine is
  doing is read off its latest run, never stored. A due routine is held while no browser is there
  (the same key the pump asks) or its bot is off, and skipped while its last run is still open;
  its next time moves on before the run opens, so two looks start one thread. Only the call holds
  the `routine` tool: what starts by itself is the user's to set up, never a bot's.
- **A desk summarizes itself at its budget, or once when asked.** `bot.run` compacts when a
  step's context passes the desk's budget. The user asking for it (the bar in a thread's
  header) is a one-shot the runner holds in memory and the run takes at its next step
  (`askCompact`, `compactNow`) — never a lowered budget, which would compact every step after.
- **A turn ending is not a thread ending.** Bots finish with ordinary text or silence. The coordinator
  reports once its downstream work settles; idle rooms remain resumable. Store local calls before
  their effects and results before the next model step. Repair missing results only in the model
  projection, with their outcome explicitly unknown. Never replay arbitrary tools automatically.
