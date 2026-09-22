---
paths:
  - "features/**/*.query.ts"
  - "features/**/*.action.ts"
  - "features/**/*.schema.ts"
  - "app/api/**"
  - "lib/protocol/**"
  - "database/**"
  - "hooks/**"
---

# Data flow

**Read** — RSC first. Server components call `<name>.query.ts` directly. Client reads go through
`app/api/<d>/route.ts` (`serverRoute(() => findAll())`) and `useServerRoute`:

```ts
const { data: notes } = useServerRoute<MemoryNote[]>(queryKey.memory);
const { data: note } = useServerRoute<MemoryNote>(path ? queryKey.notePath(path) : null); // null pauses
```

Beyond the key it is plain SWR. Responses are typed, not validated at runtime. Read failures toast
from the hook. SWR is for revalidation and dedup, not caching. A list that grows reads through
`useServerPages` instead: the caller's key function addresses a page, and the next one is asked for
when the end of the list comes into view.

**queryKey** — never write a URL in a screen. All keys live in `app/api/query-key.ts`:

```ts
export const queryKey = {
  memory: "/api/memory",
  notePath: (path: string) => ({ url: "/api/memory", query: { path } }),
  mcpServer: (name: string | null) => ({ url: "/api/mcp", pathVariable: [name] }),
} as const;
```

The key is the SWR cache key. `revalidate` matches by URL prefix, so invalidating `queryKey.memory`
also refreshes `queryKey.notePath(path)` and any loaded pages under it. A null path variable pauses
the read the same way a null key does. Invalidation is done by the writer's `onOk`, not by the
action hook:

```ts
const [create] = useServerAction(createNoteAction, {
  onOk: () => {
    revalidate(queryKey.memory);
    onDone();
  },
});
```

**Write** — no routes. Only server actions wrapped in `serverAction`. Routes exist for four cases:
external callers hitting a URL (oauth callback), work that must run in parallel (tool calls during a
call — actions are serial per client), a response that streams (the SSE route, a memory
edit drawn as the model makes it, a turn of a call in writing), and a page a bot wrote saving
itself back (`PUT` on the file route): its editor runs inside the frame that route served it
into, where no action can be reached, and it may only overwrite the `.html` it was opened as.

```ts
export const createNoteAction = serverAction(async (path: unknown, description: unknown) => {
  const parsedPath = PathSchema.parse(path); // validate inside; ZodError messages reach the UI
  const note = await createNote(parsedPath, z.string().min(1).parse(description));
  if (!note) publicError("Note already exists");
  return { id: note.id }; // plain return → Result wrapping
});
```

Actions run sequentially per client. Parallelism happens inside one action.

**Errors** — throw `publicError("message")` anywhere for user-facing failures. The boundary
(`serverAction` / `serverRoute`) forwards that message and masks everything else (logged). In screens,
`useServerAction` handles the toast, pending state and success toast. Tool failures returned to a model
are not masked: return one line the model can read and recover from.

**What an outside API answered is never masked.** A provider's refusal is the user's to act on — the
key, the credit, the model id — and only the provider can say which, so the seam that made the call
raises it public rather than letting the boundary swallow it: `createLiveCall` (lib/live) for
the call's connection, `modelErrorToString` (features/ai/model) for anything the ai sdk wrapped, which also
carries out the body when the sdk's message is the status word alone. The call's own key is
asked about as it is saved (`keyRefusal`): one the provider turns away is not kept and its
words are shown — under the field in amber on the first run and the call screen, where
nothing is broken and the key waits on the user — while no answer at all keeps the key
unasked. The one exception is a
reasoning setting the backend model refuses before a call (`acceptedReasoning`): the call runs
without it, because the user asked for the call, not for that setting.

**Server → browser** — no polling. When a fact happens on the server (a row was written, a browser
opened, something to say), `appEvents.emit` at that spot; the browser listens on one SSE stream. Two
kinds of events: a **signal** when a GET exists (the receiver `revalidate`s that key) and **data** when
none does. New event = one union line + one emit + one handler (+ one `SIGNALS` entry for signals; the
compiler enforces it). Emit where the fact happens (the query's write, the watcher), not in each caller.
A 30-second poll remains as a safety net. No WebSockets.

**What a signal re-reads is read again on every write in its domain**, so it carries only what can
still change. The inbox leaves out the transcript of a thread that has ended, and the room reads the
one it has open by id (`queryKey.thread`, under the same key so the same signal keeps it live).
Judge such a list by what one write costs to re-read, not by what it costs once.

Three things about the stream itself are not free, and each has bitten:

- **The app's own screen opens it** (`app/page`), never the layout. A browser gives an origin six
  connections and a stream holds one for as long as its tab lives, so the file viewer's tabs would
  take them all and the app's reads would queue behind nothing. That count is also `presence`, so a
  tab that does not listen must not be on the stream at all.
- **A signal goes out at once, then at most every `ms`** (`createEventStream` `coalesce`). A trailing
  timer pushed back by each new event instead sends nothing while a bot is working, which is exactly
  when the screen has something to say.
- **A stream that fails outright never comes back on its own.** EventSource retries only while the
  endpoint keeps answering as an event stream; one reply that is not (a rebuild's error page, a
  proxy) closes it for good. `fromEventSource` watches for that and opens the line again — without it
  the tab goes silent until it is reloaded, while the server reads the missing stream as nobody
  watching: its calls close, and what finishes goes to a desktop notice or a phone instead.

**Values on the wire**

- Timestamps are `DateLike` (`lib/date-like`): ISO strings on the wire, `Date` in drizzle.
  `z.coerce.date()` lies on the client.
- File route handlers receive decoded path segments; viewer pages receive encoded segments in
  this Next.js version. Use `decodePath` for handlers and `decodePagePath` for pages, exactly once.
