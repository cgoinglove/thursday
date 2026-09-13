# Task rooms

A task has one coordinator and a persistent participant for each canonical bot name. Thursday introduces the work to the coordinator. Bots exchange messages and run independently; the coordinator brings the results back to Thursday. A model invocation is one period of activity, not a new bot.

## Identity and context

A participant is identified by `(taskId, bot)`. Every continuation for that participant reads the same stored history, beginning with its original briefing and, after compaction, its latest summary. Requests from a different colleague do not create another context or browser identity. Browser session names derive from the task and canonical bot name.

`parentId` identifies the conversation to which a continuation returns. It does not identify the participant. If A waits for B and B asks A a question, A handles that question in its own context, returns the answer to B, and keeps its original responsibility to report to Thursday. Only exchanged messages enter the other participant's context. The human can inspect all recorded activity; workspace files remain shared resources.

## Messages and turns

Bots use `send_message(to, text, replyTo?)`. A send commits before returning a receipt. The sender can continue independent work or end its turn. A natural final message returns to the current correspondent; a silent ending is valid. There is no completion tool or required closing phrase.

An explicit `replyTo` routes a message to an open incoming exchange. An ordinary send opens a new exchange. Messages to Thursday request a user response and carry an addressable question ID. Other participants continue while a question is open. The screen and the voice `task` tool can direct a reply or a new message to a particular participant.

The room and its participants have separate lifecycles:

| Continuation state | Meaning |
| --- | --- |
| `queued` | Ready for the scheduler. |
| `running` | Claimed by one live turn. |
| `waiting` | The turn ended with downstream work still open. |
| `external` | A message to Thursday awaits a user response. |
| `paused` | Interrupted work awaits a permitted resume. |
| `done` | The continuation has no unread messages or open downstream work. |
| `cancelled` | The user stopped the continuation. |

Incoming messages queue a waiting continuation. At completion, the engine checks the inbox and downstream work in the same transaction that releases the claim. A message racing with an ending is handled by the current turn or its successor.

The coordinator's normal final message completes the task only when all work has settled. If activity settles without a coordinator report, the scheduler permits one wrap-up turn. An empty final turn leaves an idle, resumable room; it does not cause an automatic retry loop. Missing workspace files in a final report produce a visible pause before any artifact is opened.

## Durable state

`room.query.ts` owns transactional scheduling and messaging. `bot.runner.ts` holds live promises and abort controllers. `bot.run.ts` runs one `ToolLoopAgent` and persists events through the runner.

| Table | Responsibility |
| --- | --- |
| `task` | Room status, coordinator, reporting epoch, automatic turn budget. |
| `task_work` | Continuations, return routes, claims and claim generations. |
| `task_delivery` | Durable inbox and insertion acknowledgement. |
| `task_message` | Model history and the human-visible activity projection. |
| `task_relay` | Reports and questions awaiting delivery to Thursday. |

A partial unique index allows only one running continuation for a bot in a task. Model execution never holds the room's command lock. Cancellation and manual resume share that lock; cancellation drains the old runs before a new run can start. Generation checks reject a stale run's attempts to send messages or settle work. Actual tool results received during shutdown are retained before the drain ends.

Message receipts use a stable key derived from the task, sender and tool call ID. A repeated send returns the committed receipt. Recovery also reconstructs a known receipt when the send committed but its tool-result row did not. Inbox insertion and acknowledgement are transactional. Transcript sequence numbers are allocated at the database boundary, so different bots cannot overwrite each other's rows.

The SDK can prepare another model step before a streaming consumer finishes writing the previous step. A persistence barrier prevents that next step from starting early. Compaction is written before newly consumed inbox messages, preserving the same ordering on resume.

`BOT_RUN` in `config.ts` bounds concurrent participants, distinct participants, pending exchanges, steps per turn and automatic turns across the room. User messages and manual resumes reset the room's turn budget. Browser presence returning does not reset it.

## Interruption and recovery

Closing the last app browser pauses work; returning resumes only work paused for browser absence. A server restart, a model failure, a resource limit or a user stop waits for a person. The stored conversation and browser identity remain available. Browser processes, login state and element references may require inspection after a restart.

Before a local tool executes, its validated call is stored. Before another model step starts, its result is stored. On resume, a local call with no result receives an interruption result in the model projection: the outcome is unknown and the current state must be inspected before repeating the action. The original audit rows remain intact. Real results are preserved, malformed argument fragments do not become executable calls, and native provider operations without results become explicit interruption notes instead of fabricated local results.

This does not provide exactly-once execution against arbitrary external services. A server can disappear after a remote action succeeds and before its result is stored. The engine preserves that uncertainty and offers manual recovery rather than replaying external actions automatically.

Older `ask_bot` transcripts remain readable. On first resume, unresolved legacy delegations become continuations over the original participants' histories. Legacy tool names remain vocabulary for reading old rows; new turns receive the asynchronous tool set.

Thursday relays are persisted independently of whether a task has been opened on screen. Unaccepted reports remain in the inbox beyond the usual finished-task limit. A voice session acknowledges a relay after handing it to its transport; this is not proof that the user heard the audio. Unanswered questions are presented again on a later call.

The screen keeps unanswered questions visible even while other participants work, and keeps unread endings until the user opens them. The collapsed task panel shows both without relying on a call. Thursday's status tool returns up to ten tasks, prioritizing open work and filling the remaining places with recent endings; naming a task returns its full result and pending questions.

## Verification

`pnpm test:bot` runs the real scheduler, SQLite queries, tools, prompts and SDK loop against isolated temporary data and deterministic model streams. It checks continuity, private histories, routing, concurrent questions, completion races, interruption, cancellation, compaction and committed-message recovery. Provider adapter tests inspect serialized OpenAI, Anthropic and Google requests at a mocked HTTP boundary. They do not call live models.

Run `pnpm typecheck`, `pnpm lint` and `pnpm build` as well. Browser checks cover the task screen, participant selection, separate drafts, Markdown and long URLs. TypeScript alone does not validate Next.js client/server directives or the rendered layout.
