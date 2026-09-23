---
paths:
  - "features/**/*.query.ts"
  - "features/**/*.action.ts"
  - "features/**/*.schema.ts"
  - "app/api/**"
  - "lib/protocol/**"
  - "lib/public-error.ts"
  - "lib/date-like.ts"
  - "database/**"
---

# Data flow

**Read** — RSC first: a server component calls `<name>.query.ts` directly. A client reads through
`app/api/<d>/route.ts` (`serverRoute(() => findAll())`) and `useServerRoute`:

```ts
// app/api/mcp/route.ts
export const GET = serverRoute(() => findAllServers());

// a screen
const { data: servers } = useServerRoute<MCPServerSummary[]>(queryKey.mcp);
const { data: server } = useServerRoute<MCPServer>(queryKey.mcpServer(name)); // a null name pauses
```

Past the key it is plain SWR: typed, not validated at runtime; a read failure toasts from the hook;
SWR revalidates on mount, focus and reconnect and dedupes, and is not a cache. A list that grows
reads through `useServerPages`: the caller's key function addresses a page, and the next one is
asked for when the end of the list comes into view.

**queryKey** — no screen writes a URL. Every key lives in `app/api/query-key.ts`; the key is the SWR
cache key. `revalidate` matches by URL prefix, so invalidating `queryKey.mcp` also refreshes
`queryKey.mcpServer(name)` and every mounted page reader under it. Keys that are plain URLs for an
iframe or an image (`file`, `favicon`, `fileView`) are not SWR keys. The writer's `onOk` invalidates,
not the action hook:

```ts
const [remove, removing] = useServerAction(deleteServerAction, {
  okMessage: "Server deleted",
  onOk: () => revalidate(queryKey.mcp),
});
```

**Write** — server actions wrapped in `serverAction`, validating their input inside; a plain return
is wrapped as a `Result`, and a `ZodError` message reaches the UI. Actions run one at a time per
client, so parallel work happens inside one action. `useServerAction` returns
`[execute, isPending, data, error, reset]` and handles the pending state and the toasts; a screen
that shows a refusal inline passes `errorMessage: false` and `onError`.

A route is for three cases only: an outside caller hitting a URL (the OAuth callback), work that must
run in parallel (a call's tool calls), and a response that streams (the SSE route, a memory edit drawn
as the model makes it, a turn of a call in writing). A page a bot wrote that keeps its own edits is not
a fourth: it asks the frame showing it (`FileFrame`), and the frame calls `savePageAction` for the one
file it opened. A route that returns a `Response` passes through `serverRoute` with no `Result` around it.

**Errors** — throw `publicError("message")` anywhere for a failure the user should read. The boundary
(`serverAction` / `serverRoute`) forwards that message and masks everything else (logged). A tool's
failure returned to a model is not masked: it is one line the model can read and recover from.

**What an outside API answered is never masked.** A provider's refusal is the user's to act on — the
key, the credit, the model id — and only the provider can say which, so the seam that made the call
raises it public: `createLiveCall` (lib/live) for the call's connection, `modelErrorToString`
(features/ai/model) for anything the AI SDK wrapped, carrying out the body when the SDK's message is
the status word alone. The call's key is asked about as it is saved (`keyRefusal`): one the provider
turns away is not kept and its words are shown, in the waiting colour, since nothing is broken; no
answer at all keeps the key unasked. The one exception is a reasoning setting the backend refuses
before a call (`acceptedReasoning`): the call runs without it, because the user asked for the call.

**Server → browser** — no polling. When a fact happens on the server, `appEvents.emit` at that spot —
in the query's write, not in each caller — and the browser listens on one SSE stream. A **signal**
names a GET and the receiver `revalidate`s it; a **data** event is the value itself, for what has no
GET. A new event is one union line in `app-event.ts`, one emit and one handler, plus a `SIGNALS` entry
for a signal (the compiler enforces it). `hello` goes out on every connect, and every reconnect after
the first re-reads everything, since what changed while the line was down raised signals nobody
heard. The thread inbox alone also polls every `THREAD_POLL_FALLBACK_MS`. No WebSockets.

**What a signal re-reads is read again on every write in its domain**, so it carries only what can
still change: the inbox leaves out the transcript of a thread that has ended, and the room reads the
one it has open by id (`queryKey.thread`). Judge such a list by what one write costs to re-read.

The stream itself:

- **The app's own screen opens it** (`app/page`), never the layout. A browser gives an origin six
  connections and a stream holds one for as long as its tab lives, so the file viewer's tabs would
  take them all. That count is also `presence`, so a tab that does not listen stays off the stream.
- **A signal goes out at once, then at most every `ms`** (`createEventStream` `coalesce`). A trailing
  timer pushed back by each new event sends nothing while a bot is working, which is exactly when the
  screen has something to say.
- **A stream that fails outright never comes back on its own.** EventSource retries only while the
  endpoint keeps answering as an event stream, so `fromEventSource` opens the line again. Without it
  the tab goes silent while the server reads the missing stream as nobody watching.

**Values on the wire**

- Timestamps are `DateLike` (`lib/date-like`): ISO strings on the wire, `Date` in drizzle.
  `z.coerce.date()` lies on the client.
- File route handlers receive decoded path segments; viewer pages receive encoded ones in this
  Next.js version. Use `decodePath` for handlers and `decodePagePath` for pages, exactly once.
