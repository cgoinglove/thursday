---
checked: 2026-09-24
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

## Rules
- A fact is emitted where it is written (the domain's `*.query.ts`, or the one module that owns that state), never in a caller — an emit in a caller misses the bot, routine or phone that writes through the same function.
- A GET that a signal names carries detail only for what can still change, and a finished item's detail is read by its own key — the GET is re-read on every write in its domain, so a finished thread's lines would be read again for every row a working bot writes.
- A GET starts nothing and changes nothing a screen shows; the MCP OAuth callback, which a provider can reach only by GET, acts only on a `state` this app issued — `proxy.ts` checks where a write came from but not a read, so any page the user has open can send a GET.
- An outside API's refusal crosses the boundary in its own words: the seam that called it raises `publicError`, through `modelErrorToString` for what the AI SDK wrapped — left to `to-result.ts`, a refused key or spent credit is masked into a failure nobody can act on.
- State the server holds for its lifetime (a client, a bus, a runner, a timer, a map a route and an action share) is pinned on `globalThis` — a dev reload evaluates the module again and a route and an action can load separate copies, so a second pool or clock starts beside the first, or what an action sets never reaches the route.
- A path from a request or a model goes through `insideWorkspace` (`features/workspace/workspace.ts`) before its file is read, served or deleted — else a `..` or a symlink a bot left behind hands out any file on the machine.
- Inside `database.transaction`, every statement goes through its `tx` and nothing slow is awaited — the transaction holds the one lane, so a call on `database` waits on itself forever and a network wait stalls every read in the app.

## Check
`pnpm test:artifact` runs `scripts/proxy.test.mts` (what `proxy.ts` refuses, and a bot's page served sandboxed); `pnpm test:reach` emits on the bus and moves `presence`. To watch the stream, run a scratch server and `curl -N http://127.0.0.1:<port>/api/events`: `hello` first, then a `data:` line as each change lands.
