---
checked: 2026-09-26
paths:
  - "lib/protocol/**"
  - "lib/{public-error,date-like}.ts"
  - "app/api/**"
  - "database/**"
  - "proxy.ts"
  - "features/**/*.{query,action,schema}.ts"
  - "scripts/proxy.test.mts"
---

# Data flow and boundaries

The screen shows what the server holds, whoever changed it, and nothing but this computer reaches the app.

## Start here
- `lib/protocol/server-action.ts` — `serverAction`, which every write goes through; its error policy is `to-result.ts`.
- `lib/protocol/use-server-route.ts` — client reads over SWR, and `revalidate` by URL prefix.
- `lib/protocol/use-server-action.ts` — a write from a screen: pending state, toasts, `onOk`.
- `app/api/query-key.ts` — every endpoint the browser reads.
- `app/api/events/app-event.ts` — every event the server sends, signal or data.
- `app/api/events/app-event.server.ts` — the bus, the SSE stream and `presence`.
- `database/db.ts` — the one client, and the lane every statement waits in.
- `proxy.ts` — what may reach the app at all.

## How it fits
A server component calls a domain's query directly; a client screen reads a `serverRoute` GET by its `queryKey`, with `useServerRoute` or `useServerPages`. A write is a server action, and the screen that made it revalidates what it changed in `onOk`; one client's actions run one at a time, so a POST route exists only for work that must not wait in that line or hold it — tool calls that run side by side, and work that streams as it runs. A change the screen did not make — a bot's row, a routine, a phone — arrives as an `appEvents` signal, which a `useAppEvent` handler turns into a `revalidate` of the GET it names. On the server the same bus only wakes the phone relay (`features/reach/reach.ts`), which then reads the rows.

## What breaks
- An emit in a caller misses the bot, routine or phone that writes through the same function; a fact is emitted where it is written (the domain's `*.query.ts`, or the one module that owns that state).
- A GET a signal names is read again on every write in its domain, so detail it carries for a finished item — a finished thread's lines — is read again for every row a working bot writes; that detail is read by its own key.
- Any page the user has open can send a GET: `proxy.ts` checks where a write came from, and a read only on the routes in its `ACTING_READS` (the event stream's presence, the favicon fetch). A GET that starts or changes something is open to every site; the MCP OAuth callback, which a provider reaches only by GET, acts only on a `state` this app issued.
- `to-result.ts` masks a refused key or spent credit into a failure nobody can act on, unless the seam that called the outside API raises `publicError` in its words (through `modelErrorToString` for what the AI SDK wrapped).
- A dev reload evaluates a module again, and a route and an action can load separate copies: server-lifetime state (a client, a bus, a runner, a timer, a map a route and an action share) not pinned on `globalThis` starts a second pool or clock beside the first, or what an action sets never reaches the route.
- A path from a request or a model that skips `insideWorkspace` (`features/workspace/workspace.ts`) before its file is read, served or deleted hands out any file on the machine through a `..` or a symlink a bot left behind.
- A transaction holds the database's one lane: a statement inside `database.transaction` that goes through `database` rather than its `tx` waits on itself forever, and a network wait inside it stalls every read in the app.

## Check
`pnpm test:artifact` runs `scripts/proxy.test.mts` (what `proxy.ts` refuses, and a bot's page served sandboxed); `pnpm test:reach` emits on the bus and moves `presence`. To watch the stream, run a scratch server and `curl -N http://127.0.0.1:<port>/api/events`: `hello` first, then a `data:` line as each change lands.
