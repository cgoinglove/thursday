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
  - "docs/thread-rooms.md"
---

# Bots, threads and the jobs they run

`docs/thread-rooms.md` is the contract for a thread's participants, messages and turns, and
changes with the code. This file holds what the runner and its neighbours keep.

## Runs

- **A job's run is the server's, not the request's.** It is a promise the server holds
  (`bot.runner` `launch`), never `after()`: routines, a phone and messages between bots start runs
  outside any request. Everything a run does is written as rows, so what the screen draws and what
  the model re-reads are the same rows.
- **Server-held state is pinned on `globalThis`** (the runner, the routine clock, the event bus), so
  a dev reload never starts a second one.
- **Claiming is serialized under `threadLock`, and no model call holds it.** A removal re-reads
  inside the lock, and `generation` refuses a stale turn.
- **Work runs for as long as the server does, watched or not.** No browser is needed and there is no
  switch for it. `presence` answers only what is about someone watching: the calls a tab held close
  once the last tab has been gone `BROWSER_GONE_MS` (never one held for a phone, `heldCalls`), a
  finished job raises a desktop notice, open work goes to a phone. Nothing starts because a browser
  came back.
- **A job is bounded by its own limits (`BOT_RUN`) and never ends as a failure.** A model call that
  breaks is tried once more after `BOT_RUN.retryMs`; a second break, a provider's refusal, a
  resource limit or a user stop waits for a person, and boot parks every thread that was running
  (`sweepThreads`) until someone presses Continue. Wired once at boot (`instrumentation-node`), not
  in each domain.
- **A turn ending is not a thread ending.** A bot finishes with ordinary text or silence; the
  thread's own bot reports once its downstream work settles, and an idle room stays resumable.
  Store a local call before its effects and a result before the next model step. Repair a missing
  result only in the model's projection, with its outcome stated as unknown. Never replay a tool
  automatically.
- **Old work is cleared by age** (`WORKSPACE_KEEP`, `HISTORY_KEEP`) at boot and on a timer, under the
  job lock. What a job finished stays in the workspace's artifacts folder.

## Participants and messages

- **One participant per bot per thread.** A bot resumes its own stored transcript across requests
  and callers; `parent` names the current exchange, not the bot. Requests to one bot run in order,
  and a bot waiting on the user's answer runs nothing until it comes; its inbox holds. Only
  exchanged messages cross participant contexts. `room.query` owns durable inboxes, continuation
  claims and return routes; `bot.runner` owns live promises.
- **A message is a call, and a turn's last words are its return.** `send_message` to another bot
  opens an exchange (`thread_work`: who called, whose row to wake), and the callee's final text
  reaches the caller's inbox once its row is done — never while it still waits on anyone it called
  (`finishRoomWork`). So the bot being answered is never messaged: `sendRoomMessage` refuses it and
  says why. Words to a bot already on a call from the sender join that call (`tellRoom`), so one
  job gives one answer.
- `send_message` carries a `why` beside its words, kept in the stored tool call's own arguments
  rather than a column.

## The workspace and the browser

- **Where a bot may write is enforced** (`writeRefusal`): its own `artifacts/<bot>`, `projects`,
  `scratch`, `bots` and `.agents`. The workspace root and the app's folder are refused.
- **The server sets a shell's environment; a model never types it** (`jobShellEnv`, `botShellEnv`:
  the browser session, `THURSDAY_BOT`, `THURSDAY_ARTIFACTS`, `THURSDAY_SKILLS`, and the browser boot
  downloads, `ensureBrowser`). Left to itself the browser CLI launches the user's own Chrome, which many
  machines lack and which on macOS takes the links the user opens.
- Browser sessions are named by thread and bot, and the workspace is marked as the browser CLI's
  own (`.playwright`), so what they keep on disk is this app's alone: a cancel closes the windows,
  and a removed or aged-out thread takes its profiles with it. One profile per bot across threads
  cannot work — two browsers on one profile refuse to open.

## Sign-ins

- **A sign-in is the app's to keep and the user's to lend.** A bot borrows one with `sign_in_use` and
  hands over one the user just made with `sign_in_keep`. Sessions live under `DATA_DIR/.sign-ins`,
  one file a site, outside the workspace, and cross into it only as a file that exists for one
  browser-CLI command — a place, not a lock. Which bots may borrow is settled on screen only
  (Settings › Sign-ins, or the button on a waiting bot's question, `signin-ask`); nothing a tool is
  told lets a bot in.
- After every bot turn the cookies a kept sign-in holds are copied back from that browser
  (`renewSignIns`); a stale copy can end the session. A name stands for the sign-in kept over it
  (`myaccount.google.com` borrows `google.com`). A site that binds a session to the browser it was
  made in (Google) refuses any copy; that work goes to the user's own Chrome (`attach --extension`,
  the browser skill), from which nothing is kept and into which nothing is loaded (`sessionBrowser`).

## Routines

- **A routine only opens threads.** `routine.clock` finds what is due and calls `startThread`;
  everything after is the thread's, and the room engine knows nothing of routines. A run carries
  `thread.routine_id`, and how a routine is doing is read off its latest run, never stored.
- A due routine is held while its bot is off and skipped while its last run is open. Its next time
  moves on before the run opens, so two looks start one thread; one that starts once has no next
  time and switches itself off, and a moment already gone is refused as it is set.
- Only the call holds the `routine` tool: what starts by itself is the user's to set up, never a bot's.

## Compaction

- **A desk summarizes itself at its budget, or once when asked.** `bot.run` compacts when a step's
  context passes the desk's budget, measured by what the provider counted, and by `sizeOf` only
  where it counts nothing — never the larger of the two, since `sizeOf` counts a picture as its
  base64. The user asking (the bar in a thread's header) is a one-shot the runner holds
  (`askCompact`, `compactNow`), never a lowered budget.
- A transcript too long even to summarise is asked once more as its words alone (`ai/words`). Never
  `pruneMessages` there: it drops a tool call and keeps the reasoning that led to it, and OpenAI
  refuses a reasoning item that arrives without what it led to.
