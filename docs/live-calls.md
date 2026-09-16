# Live calls

Thursday uses GPT-Live 1 for voice and Responses delegation for short reasoning and
tool use. The default backend is GPT-5.6 Luna. Background bots keep their own
models, prompts, durable threads, and execution budgets; the voice settings do not
change the text or media providers available to them.

This document is the implementation contract for calls. Keep it aligned with the
code when changing session events, settings, prompts, or persistence.

## Responsibilities

| Runtime | Context and instructions | Work |
| --- | --- | --- |
| Live voice | `live.prompt`: who Thursday is, the delegation policy (what the backend can do, when to hand over), profile and preferences with the note listing; earlier spoken turns as `input` behind a developer note | Listen, speak, backchannel, handle interruptions, decide when the backend is needed |
| Responses backend | `thursday.prompt`: who Thursday is, the voice conversation it works from, memory with ids, bot roster and what bots can reach, this computer, what to return, earlier calls with their jobs; tool schemas | Recall and update memory, run short commands, route thread messages and cancellations, delegate long work |
| Background bots | `bot.prompt` and the stored participant transcript | Shell, browser, MCP, skills, and work that outlives a call |
| Application | Authoritative database and tool implementations | Validate actions, retain results, enforce thread limits, render progress, save call history |

Use Responses delegation because Live supplies conversation context and manages the
backend connection. Do not build a second transcript-to-thread orchestrator. Client
delegation is a different integration: its notification contains metadata, not thread
text, so the application would have to reconstruct the request and operate the backend.

The voice and the backend are one assistant. Both prompts open with the same identity
(`thursdayIdentity`) and the same rule for ending the call (`callEnding`), read the same
memory, and neither is told it is part of something else. The voice prompt follows the
GPT-Live prompting guide's `Delegation policy` labels —
`Backend tools`, `Delegate to the backend when`, `Do not delegate to the backend when` — and
says nothing about how to speak, which the Live model does itself; it never sees tool names
or schemas. The backend prompt follows the guide's backend template: the voice conversation
it works from (transcripts can be wrong and corrected later), one chapter per capability the
voice lists, and what to return.

## Settings and upgrades

Voice uses the fixed `gpt-live-1` model. Settings › Thursday exposes a voice and
additional voice instructions; for the backend, a model,
optional reasoning effort, web search, and additional backend instructions. Both
instruction fields add to the app's prompts and never replace them. The model list
shows recent models; an older or custom ID can be typed and saved. Live accepts any
reasoning settings when the call opens and fails the backend's first response when the
model does not take one, so the server asks the token-count endpoint first
(`acceptedReasoning`), once per model and effort. A setting refused by name, the effort or
the summary, is dropped and not shown; a refused model or key still reaches the user when the
call opens. Auto reasoning sends no effort.
Web search adds the `web_search` tool only when switched on. Changes apply from the
next call.

Settings stay in the browser under the existing `thursday.settings` key, beside wake
word, shortcut, captions and call-back (`thursday.store`). `migrateLiveSettings`
upgrades stored values: an OpenAI voice and backend model carry over, a Grok voice is
retired without touching historical calls or xAI text and media keys, and the old
shared instruction is copied into both new instruction fields. Each field recovers on
its own, so one malformed value falls back to its default and leaves the rest.

Every call is kept on this machine. Live transcription needs no separate model or
request, so there is nothing to switch off to save cost. Keep `store: false` in the
provider request: local history is distinct from OpenAI session recording and fork
storage.

## Connection and opening

1. In the user's gesture, before anything awaits, prepare playback. Then request
   microphone access and gather WebRTC ICE.
2. Send the SDP offer and the parsed settings to `openCallAction`. The browser sends
   settings only; the server reads the key.
3. On the server, assemble both prompts and the current tool manifest. Create the
   Live session with the fixed voice model, the chosen voice, voice instructions,
   earlier spoken turns in `input`, and `delegation.responses` backend settings.
   Insert the call row only after the provider accepts, so a refusal leaves no open row.
4. Apply the SDP answer and wait for `session.started`. Do not send Realtime startup
   configuration, audio commits, or a voice `response.create`.
5. Send the opening as `session.instructions.append`, so she speaks first: a first call
   (no profile facts) greets the user and asks what to call them, memory past
   `MEMORY_LIMITS` raises tidying, and any other call opens with a short greeting.
   Updates that arrived while connecting follow once she has voiced the opening.

`input` opens with a developer message saying the turns after it are from earlier calls
and that none is a request now, then holds user and assistant turns, newest kept first
within `RECENT_CALL` and the provider limits of 128 messages and 8,192 tokens. Tool turns
stay out, since voice holds no tools. It always ends on an assistant turn: a call that
ended on the user's words would leave a turn that Live answers the moment the next call
opens.

A hang-up during startup invalidates that attempt, so a connection that finishes
later is closed rather than taking over the screen. Do not change machine trust,
certificate, or proxy configuration to hide connection errors.

## Tools and background updates

Live speech and backend work have independent lifecycles. Unwrap `response.event`
and associate its delegation with the response ID from `response.created`. Collect
complete function calls from `response.output_item.done`, deduplicate by call ID, and
run existing server handlers through the tool-call route. Terminal response snapshots
intentionally omit output items. Submit every function output with
`response.item.create`, then explicitly continue with one `response.create`. That
command continues backend work; it does not grant permission for Live to speak. A
response that ends incomplete after asking for tools is still continued once its outputs
are in, or the backend turn never finishes; a failed or cancelled response, or a second
incomplete in a row, only warns. A function call the output cap cuts off arrives as an
item with status `incomplete` and fragment arguments, and Live ends that handoff with a
top-level `error` instead of a terminal event: the call is not run and its response
counts as finished, though calls it completed before the cut still have their results
continued once. The backend is asked for `reasoning.summary: "auto"` unless the
effort is `none`. Each finished summary part (nested `response.reasoning_summary_text.done`,
only while the model reasons) is stored with its call in `call_thought` to look into
later; nothing draws it or reads it back into a prompt. Tools are sent without `strict`, so each schema that allows it is
decoded to the schema; `strict: false` would let a model write arguments that are not
JSON, and `strict: true` is refused while any schema has optional fields. Live has no
`response.cancel`.

Long work enters the existing bot runner and returns a thread receipt immediately.
Background questions and results follow the existing durable relay queue. A voice
interruption never cancels a thread by itself. Route an explicit cancellation or
correction to the owning thread and report its actual outcome.

| Update | Live event |
| --- | --- |
| Opening, idle goodbye, other trusted behavior | `session.instructions.append` |
| Screen actions the voice should know but need not say | `session.thinking.append` |
| A bot's result or question to convey | `session.commentary.append` |

Bot output is never sent as instructions. Each append carries a required
`delegation_id`, `null` for application updates in Responses mode; a response ID is
not a client delegation ID. Appends are serialized and matched to their
acknowledgement by `client_event_id`. An update longer than one append is split at
word boundaries under 480 UTF-8 bytes, which keeps within the 500-token limit for any
script, and sent chunk by chunk. A rejected or unacknowledged chunk drops the rest of
its update, warns, and is never replayed. An acknowledgement is not proof of speech.

Live never speaks unprompted, so what waits on the user reaches them only when the page puts
it in. The relay clock (`useThursday` `relayOpenWork`) reads the inbox once a second and sends
open work only when neither side's words have been transcribed for `CALL_RELAY.quietMs` and
no backend work or tool is running: questions not answered, jobs stopped, failed or finished
and not yet seen, and progress from jobs still running. Up to `CALL_RELAY.perTurn` items of one
kind go in one commentary append, most pressing first, so an ending never shares an append with
a question. The activity line carries the update from the moment
it goes out until her voice has finished it, and nothing else goes in until her voice has started
and stopped (at most `CALL_RELAY.readMs`). An item is handled when it is answered, marked seen
by the backend's `thread` `seen` once the user has been told enough, or opened on screen — the
backend's `thread` `open` opens it in the call screen's room (a `showThread` event). Each item
goes in once a call (`told`, in memory), and it stays in the inbox and on screen until handled.
One her voice carried stays out of later calls too while the page is open; one it did not (Live
refused it, she never spoke, the call ended first) goes in again on the next call, never in a
loop on this one. The key carries the job's last change, so a job that resumes and asks or ends
again is a new item, and a reload puts what is still open in once more. Nothing goes in while
the call is ending or a goodbye has been asked for. Each relay follows an `instructions` note
that what she has already told the user need not be said again, so the relay itself stays
facts only.

A relay names the bot and the thread and, for a question, where its answer goes (thread,
recipient, `replyTo`). The backend reads relays in its conversation and routes the user's
answer from those facts, so a relay carries no instructions. Relay rows are accepted
(`acceptThreadRelaysAction`) once Live acknowledges the append; an ending also covers its
job's progress rows. Being put to her does not mark a result seen.

## Transcript and screen

Input and output transcript events contain `delta`, `start_ms`, and `end_ms`. They
have no authoritative completed-turn event. The session folds fragments into
revisable display groups by speaker and time, deduplicates them by event ID, and
checkpoints changed groups every `LIVE_CALL.transcriptSaveMs` with their exact
fragments. A late fragment revises its group, which is saved again. Never derive
actions or cancellations from the grouping. Backend text is not a transcript of spoken
audio and never becomes a caption.

`call_message.fragments` keeps the original fragments beside each saved group; a
revision replaces them and keeps the group's `seq`. Rows written before Live have no
fragments and remain readable.

Track listening, playback, and backend work independently, from local audio levels
and backend events. The idle clock rewinds on transcribed words, her voice
and backend work, not on microphone level alone, so a noisy room does not hold a call
open, and not on an update she voices on her own, so waiting results do not either. After
`CALL_IDLE.hangUpMs` she is asked for a goodbye, and the page hangs up
`CALL_IDLE.graceMs` later if the line is still open.

## Closing and recovery

A request to end the call, whether to hang up or a goodbye, sets everything else aside:
the voice hands it to the backend at once and says a brief okay while `end_call` runs.
The page does not close on `end_call` itself: it waits until her voice has been quiet
for `CALL_END.quietMs`, or `CALL_END.unsaidMs` when nothing was said, never past
`CALL_END.maxMs`.

Stop accepting new work, send `session.close`, and keep the connection while waiting
for `session.closed`. Its reason and billed seconds are recorded on the call row
(`ended_reason`, `seconds`) next to the backend model. Without a confirmation within
`LIVE_CALL.closeMs`, the call warns and the seconds stay unknown. The screen shows
Ending until cleanup finishes and blocks a second call during that interval.
Background jobs follow existing presence rules and survive the call.

A new connection is a new session. Seed it with relevant saved history and current
thread state. Reconcile completed operations and suppress stale results; never replay
tools merely because the previous connection disappeared. Live charges active session
time, including silence and backend waits; backend tokens are separate.

## Validation

`pnpm test:live` covers tool continuation, including the one continuation after an
incomplete response, fragment grouping and late revision, closing with and without
confirmation, activity while speaking and working, append ordering, acknowledgement,
rejection and chunking, the provider request with optional reasoning and web search,
settings migration, both assembled call prompts and the identity they share, and fragment
persistence against a migrated database. Also run typecheck, lint, build and
`pnpm test:bot`, and read both assembled prompts.

Inspect settings on desktop and narrow screens. Real-call checks cover a first
greeting, overlapping speech, a short tool call, a bot
question answered during other work, correction, cancellation, a late result,
reconnect, and the recorded seconds. Count durable tool calls and thread
messages as well as listening to the actual audio.

## Official references

- [Getting started](https://developers.openai.com/api/docs/guides/live)
- [Voice prompting](https://developers.openai.com/api/docs/guides/live-prompting)
- [Sessions, transcripts, and closure](https://developers.openai.com/api/docs/guides/live-conversations)
- [Responses delegation and updates](https://developers.openai.com/api/docs/guides/live-delegation)
- [Migration](https://developers.openai.com/api/docs/guides/live-migration)
- [Partner integrations](https://developers.openai.com/api/docs/guides/live-partner-integrations)

Thursday uses direct browser WebRTC. LiveKit, Pipecat, and telephone integrations
are not required for this media path.
