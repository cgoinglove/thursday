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
  The browser is the build boot downloads (`ensureBrowser`), named in every shell
  (`jobShellEnv`); left to itself the CLI launches the user's own Chrome, which many machines
  lack and whose window on macOS takes the links the user opens.
  Requests to the same bot run sequentially, and a bot waiting on the user's answer runs nothing
  until it arrives; its inbox holds. Only exchanged messages cross participant contexts. `room.query` owns durable inboxes,
  continuation claims and return routes; `bot.runner` owns live promises.
- **A message says why it was sent, and the reason is the user's to read.** `send_message` takes
  a `why` beside its words: only the thread's own bot reaches the screen, so a job half done by
  someone it brought in reads as one bot's work, and the user cannot tell who did what. It is
  kept by the tool call itself, which stores its arguments whole, so it costs no column.
- **A message is a call, and a turn's last words are its return.** `send_message` to another bot
  opens an exchange (`thread_work`: who called, whose row to wake), and the callee's final text
  comes back to the caller's inbox once its row is done — never while it still waits on anyone it
  called itself (`finishRoomWork`). So the one being answered is never messaged, and
  `sendRoomMessage` refuses it and says why: sent upward, a message would open an exchange the
  other way, each side's ending would wake the other, and the room's report would be the last
  pleasantry rather than the result. A question back to the caller is how the turn ends, and the
  caller's reply is a new call onto the same desk. Words to a bot already on a call from the
  sender join that call and are read before its next step, as the user's own are (`tellRoom`),
  so one job gives one answer.
- **A sign-in is the app's to keep and the user's to lend.** A bot borrows one with
  `sign_in_use` and hands over the one the user just made with `sign_in_keep`
  (`tools/signin.tool`); the session lives under `DATA_DIR/.sign-ins`, one file a site, outside
  the workspace, and crosses it only as a file that exists for one browser-CLI command. That is
  a place, not a lock — a bot's shell is not confined — and what it buys is that no bot comes
  across another's session among its files. Which bots may borrow is settled on screen only
  (Settings › Sign-ins, or the button a waiting bot's question carries,
  `signin-ask`): a refused borrow is noted as `asking`, and nothing a tool is told lets a bot
  in. Boot takes in what bots used to keep under `bots/<name>/.auth`. Sites renew session cookies
  as they are used, so after every bot turn the cookies a kept sign-in already holds are copied back
  from that participant's browser (`renewSignIns`); a copy left stale can end the session.
  A name stands for the sign-in kept over it: `myaccount.google.com` borrows what was kept as
  `google.com`. A site that binds a session to the browser it was made in refuses the copy
  however fresh (Google: signed out four minutes after it was kept), and no renewing fixes
  that — such work goes to the user's own Chrome (`attach --extension`, the browser skill).
  Nothing is kept from that browser or loaded into it (`sessionBrowser`): its state is every
  site they are signed in to, and a kept session loaded there would replace their own.
  One profile for a bot across threads was tried and dropped: two browsers on one profile
  refuse to open, and a bot has two whenever threads overlap or a headed window outlives its job.
- **Work runs for as long as the server does, watched or not.** A phone, a routine and a server
  kept up from login all start work with no browser open, so a missing browser stops nothing and
  there is no switch for it: a job handed over from a phone once sat parked while she promised
  its result. `presence` (app/api/events) still says whether a browser is on the stream, and
  answers only what is about someone watching: the calls a tab held close when the last one has
  been gone a while (never one the server holds for a phone, `reach` `heldCalls`), a finished
  job raises a desktop notice, and open work goes to a phone. What bounds a job is its own
  limits (`BOT_RUN`), which never depended on a tab. A model call that breaks
  is tried once more (`BOT_RUN.retryMs`); a second break, a provider's refusal, a server restart,
  a resource limit or a user stop waits for a person. Wired once at boot (`instrumentation`),
  not in each domain.
- **A routine only opens threads.** `routine.clock` looks for what is due and calls `startThread`;
  everything after that — questions, stops, the relay into a call — is the thread's, and nothing in
  the room engine knows a routine exists. A run carries `thread.routine_id`, and how a routine is
  doing is read off its latest run, never stored. A due routine is held while its bot is off, and skipped while its last run is still open;
  its next time moves on before the run opens, so two looks start one thread — one that starts
  once has no next time and is switched off instead, and a moment already gone is refused as
  it is set (`routine.query`). Only the call holds
  the `routine` tool: what starts by itself is the user's to set up, never a bot's.
- **A desk summarizes itself at its budget, or once when asked.** `bot.run` compacts when a
  step's context passes the desk's budget, measured by what the provider counted and by
  `sizeOf` only where it counts nothing — never the larger of the two. `sizeOf` reads a
  message as its JSON, so a picture is counted as the length of its base64: one screenshot
  measured around 350k tokens against a 400k budget where the provider charged a couple of
  thousand, and a job summarised itself with its window almost empty. The user asking for it (the bar in a thread's
  header) is a one-shot the runner holds in memory and the run takes at its next step
  (`askCompact`, `compactNow`) — never a lowered budget, which would compact every step after.
  A transcript the provider refuses even to summarise is asked once more as its words alone
  (`ai/words`). Never `pruneMessages` there: it takes a tool call and leaves the thought that
  led to it, and OpenAI's API refuses a conversation in which a thought arrives without what
  it led to.
- **A turn ending is not a thread ending.** Bots finish with ordinary text or silence. The coordinator
  reports once its downstream work settles; idle rooms remain resumable. Store local calls before
  their effects and results before the next model step. Repair missing results only in the model
  projection, with their outcome explicitly unknown. Never replay arbitrary tools automatically.
