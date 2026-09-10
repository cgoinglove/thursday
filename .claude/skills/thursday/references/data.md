# Database

One SQLite file, one writer, drizzle in `*.query.ts` only. Read this before a schema change or
anything that writes from more than one place.

- **SQLite has one writer, so the app makes one request at a time** (`database/db.ts` `oneAtATime`).
  Several flows write at once — a run per job, a background pass, the routes the browser hits every
  time a write emits an event — and SQLite answers the losers with `SQLITE_BUSY` instead
  of queueing them. Measured on the real write paths: three runs, one background pass and two readers gave
  245 failures in a tenth of a second; serialising gave 0 in the same time, because the writes were
  always going to happen one after another. The busy timeout does **not** substitute for it (with it
  set, the same run still lost all 245 after waiting 52 seconds — a starved writer keeps losing), and
  it belongs on `createClient` rather than in a `PRAGMA`: a libsql client is a connection *pool*, and
  a pragma reaches only the connection that ran it — one of eight came back with the timeout set and
  seven with zero. The lane wraps the client, not each query, because a rule kept at seventy call
  sites returns the first time one is missed. A transaction holds the lane until it settles, so a
  transaction body must use its `tx` and never `database`.

- **A generated migration is edited before it is committed, so running it twice is not an error.**
  `db:generate` writes bare `CREATE TABLE` / `CREATE INDEX`; add `IF NOT EXISTS` to every one, and
  `IF EXISTS` to every `DROP`. Drizzle skips what it has already recorded, so this is not for the
  normal path — it is for the DB that has the table but not the row: a `db:push` from before the
  rule above, a hand-restored file, a migration that half-applied. That DB currently dies at boot
  (`instrumentation` migrates first), and the message names a table, not a cause.
  SQLite has no conditional `ALTER`, so a column add cannot be guarded this way; when one is
  unavoidable, say so in the PR rather than hiding it behind a rewritten table.
