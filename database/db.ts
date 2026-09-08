import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { type Client, createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { DB_FILE_NAME } from "@/config";

/** libsql spells it `file:/…/local.db`; on disk it is the part after the scheme. */
const DB_PATH = DB_FILE_NAME.replace(/^file:/, "");

// The data root may not exist yet — a first `npx thursday` points DATA_DIR at a
// home folder nobody has made. SQLite will not create the folder, only the file.
mkdirSync(dirname(DB_PATH), { recursive: true });

/**
 * Pinned to globalThis: next dev reloads this module, and a second client is a
 * second connection to the same file. Connections do not share a writer, so
 * every extra one is another party to the same lock — and the write that ends a
 * run is the one that cannot afford to lose it.
 */
type Pinned = { __dbClient?: Client };

const client: Client = ((globalThis as Pinned).__dbClient ??= connect());

function connect(): Client {
  const made = createClient({ url: DB_FILE_NAME });

  // Not awaited: statements on one connection run in order, and a top-level
  // await would keep this module out of CJS consumers.

  // SQLite defaults foreign_keys to OFF per connection; without this, cascades
  // do not run.
  void made.execute("PRAGMA foreign_keys = ON");

  // Under the default rollback journal a reader and the writer take turns: a bot
  // writing its thread holds off the routes reading it, and a route read holds
  // off the write that ends a run. WAL lets them run at once. Set on the file,
  // not the connection, so it survives; it only takes when nothing else has the
  // database open, which is why the app sets it before anything else runs.
  void made.execute("PRAGMA journal_mode = WAL");

  // A locked database is a wait, not a failure. The default is zero, so a write
  // that meets a reader throws SQLITE_BUSY on the spot — and background writers
  // (bot runs, reading calls back) run while routes and the event stream read.
  void made.execute("PRAGMA busy_timeout = 5000");

  return made;
}

export const database = drizzle({ client });
