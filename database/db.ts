import { chmodSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { type Client, createClient, type Transaction } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { DB_FILE_NAME, DB_PATH } from "@/config";
import { PromiseChain } from "@/lib/utils";

// The data root may not exist yet — a first `npx thursday-agent` points DATA_DIR
// at a home folder nobody has made. SQLite will not create the folder, only the
// file.
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
  // writing its messages holds off the routes reading it, and a route read holds
  // off the write that ends a run. WAL lets them run at once. This one is safe
  // to send as a pragma because it is a property of the file, not of the
  // connection: it survives, and every later connection opens into WAL.
  //
  // Not awaited: statements queue on the client, and a top-level await would
  // keep this module out of CJS consumers. `ownerOnly` follows the first
  // statement because SQLite does not make the file until one runs.
  void made.execute("PRAGMA journal_mode = WAL").finally(ownerOnly);

  return made;
}

/**
 * Locks the database to the account that runs the app. It holds every provider
 * key and every sign-in token as plain text (features/config), and SQLite makes
 * the file with the process umask — 644 on macOS, which any other account on the
 * machine can read, as can whatever syncs the folder it sits in. The sign-ins
 * beside it are already owner-only (signins.query write).
 */
function ownerOnly(): void {
  for (const file of [DB_PATH, `${DB_PATH}-wal`, `${DB_PATH}-shm`]) {
    try {
      chmodSync(file, 0o600);
    } catch {
      // A sidecar SQLite has not written yet, or a file this account does not own
    }
  }
}

/**
 * Folds the write-ahead log back into the database file. Under WAL the recent
 * writes live in `local.db-wal` and SQLite folds them in when it chooses, so a
 * copy of `local.db` on its own can be missing everything since the last fold —
 * and a copy is what a backup, or a move to another machine, takes. Called as the
 * server stops (instrumentation), the one moment nothing else is writing.
 */
export async function checkpoint(): Promise<void> {
  await client.execute("PRAGMA wal_checkpoint(TRUNCATE)");
}

/**
 * Gives the deleted rows' pages back to the disk. SQLite hands them to its own
 * free list instead, so the file never shrinks below the most it has ever held
 * and someone who wipes a year of calls to make room gets none of it back. It
 * rewrites the whole file, so it belongs to a wipe that is already rare and
 * deliberate (thursday.action resetHistory), never to deleting one call.
 */
export async function reclaim(): Promise<void> {
  await client.execute("VACUUM");
}

export const database = drizzle({ client });

/**
 * SQLite has one writer, so this app makes one request at a time.
 *
 * Without this the app is several writers at once — a bot run per job, a
 * background pass, and the routes the browser hits every time a write emits an
 * event — and SQLite answers the losers with `SQLITE_BUSY` rather than a queue.
 * Measured on the app's own write paths: three runs, one background pass and
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
    // Handed through by name: the libsql client is a class, so a spread copies
    // `closed` as a frozen `false` and drops `close`, `sync` and `reconnect`
    get closed() {
      return inner.closed;
    },
    protocol: inner.protocol,
    close: () => inner.close(),
    sync: () => inner.sync(),
    reconnect: () => inner.reconnect(),
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
