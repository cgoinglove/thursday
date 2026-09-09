import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { type Client, createClient, type Transaction } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { DB_FILE_NAME } from "@/config";
import { PromiseChain } from "@/lib/utils";

/** libsql spells it `file:/…/local.db`; on disk it is the part after the scheme. */
const DB_PATH = DB_FILE_NAME.replace(/^file:/, "");

// The data root may not exist yet — a first `npx thursday` points DATA_DIR at a
// home folder nobody has made. SQLite will not create the folder, only the file.
mkdirSync(dirname(DB_PATH), { recursive: true });

/**
 * How long a statement waits for the writer before giving up. A locked database
 * is a wait, not a failure: background writers (bot runs, reading calls back)
 * write while routes and the event stream read.
 *
 * It is passed to `createClient`, not sent as `PRAGMA busy_timeout`, and that
 * is the whole point. A libsql client is a *pool*, not a connection: every
 * statement takes whichever connection is free, a transaction holds its own for
 * as long as it runs, and new connections are opened as needed. A pragma
 * reaches only the one connection that ran it — measured, one of eight came
 * back with the timeout set and seven with SQLite's default of zero, so seven
 * writers out of eight failed the instant they met the writer instead of
 * waiting. `timeout` is handed to every connection the pool opens.
 */
const BUSY_TIMEOUT_MS = 5000;

/**
 * Pinned to globalThis: next dev reloads this module, and a second client is a
 * second pool over the same file — more connections contending for the one
 * writer, and the write that ends a run is the one that cannot afford to lose.
 */
type Pinned = { __dbClient?: Client };

const client: Client = ((globalThis as Pinned).__dbClient ??= oneAtATime(
  connect(),
));

function connect(): Client {
  const made = createClient({
    url: DB_FILE_NAME,
    timeout: BUSY_TIMEOUT_MS,
  });

  // Under the default rollback journal a reader and the writer take turns: a bot
  // writing its thread holds off the routes reading it, and a route read holds
  // off the write that ends a run. WAL lets them run at once. This one is safe
  // to send as a pragma because it is a property of the file, not of the
  // connection: it survives, and every later connection opens into WAL.
  //
  // Not awaited: statements queue on the client, and a top-level await would
  // keep this module out of CJS consumers.
  void made.execute("PRAGMA journal_mode = WAL");

  return made;
}

export const database = drizzle({ client });

/**
 * SQLite has one writer, so this app makes one request at a time.
 *
 * Without this the app is several writers at once — a bot run per job, the pass
 * that reads calls back, and the routes the browser hits every time a write
 * emits an event — and SQLite answers the losers with `SQLITE_BUSY` rather than
 * a queue. Measured on the app's own write paths: three runs, the tidy pass and
 * two readers produced 245 `SQLITE_BUSY` failures in a tenth of a second, and
 * `BUSY_TIMEOUT_MS` alone did not fix it — with the timeout in place the same
 * run still lost all 245, having spent 52 seconds waiting first, because a
 * starved writer keeps losing the race. Serialising left 0, in the same time:
 * the writes were always going to happen one after another, and queueing only
 * decides whether the loser waits or fails.
 *
 * It wraps the libsql client rather than each query, because a rule that has to
 * be remembered at seventy call sites is a rule that comes back the first time
 * one is missed. `concurrency: 1` cannot stand in for it: a single-connection
 * pool rejects with `TRANSACTION_ACTIVE` while a transaction is open instead of
 * waiting.
 *
 * A transaction takes the lane when it opens and gives it back when it commits
 * or rolls back, so nothing slips between its statements. Its own statements go
 * straight to it — going through the lane again would wait on the lane it
 * holds. For the same reason a transaction body must use its `tx`, never
 * `database`.
 */
function oneAtATime(inner: Client): Client {
  const lane = PromiseChain();

  /** Takes the lane and hands back the release; for work that spans many awaits. */
  const hold = (): Promise<() => void> =>
    new Promise((taken) => {
      let release!: () => void;
      const until = new Promise<void>((done) => {
        release = done;
      });
      void lane(async () => {
        taken(release);
        await until;
      });
    });

  return {
    ...inner,
    execute: (...args: Parameters<Client["execute"]>) =>
      lane(() => inner.execute(...args)),
    batch: (...args: Parameters<Client["batch"]>) =>
      lane(() => inner.batch(...args)),
    executeMultiple: (...args: Parameters<Client["executeMultiple"]>) =>
      lane(() => inner.executeMultiple(...args)),
    migrate: (...args: Parameters<Client["migrate"]>) =>
      lane(() => inner.migrate(...args)),

    async transaction(...args: Parameters<Client["transaction"]>) {
      const release = await hold();
      let open: Transaction;
      try {
        open = await inner.transaction(...args);
      } catch (cause) {
        release();
        throw cause;
      }
      // Released once, whichever way it ends. A transaction that is never
      // settled holds the lane for good, which is drizzle's contract to keep.
      let freed = false;
      const free = () => {
        if (freed) return;
        freed = true;
        release();
      };
      return {
        execute: (...call: Parameters<Transaction["execute"]>) =>
          open.execute(...call),
        batch: (...call: Parameters<Transaction["batch"]>) =>
          open.batch(...call),
        executeMultiple: (
          ...call: Parameters<Transaction["executeMultiple"]>
        ) => open.executeMultiple(...call),
        get closed() {
          return open.closed;
        },
        commit: () => open.commit().finally(free),
        rollback: () => open.rollback().finally(free),
        close: () => {
          try {
            open.close();
          } finally {
            free();
          }
        },
      } satisfies Transaction;
    },
  };
}
