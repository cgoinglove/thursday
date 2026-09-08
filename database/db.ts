import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { DB_FILE_NAME } from "@/config";

/** libsql spells it `file:/…/local.db`; on disk it is the part after the scheme. */
const DB_PATH = DB_FILE_NAME.replace(/^file:/, "");

// The data root may not exist yet — a first `npx thursday` points DATA_DIR at a
// home folder nobody has made. SQLite will not create the folder, only the file.
mkdirSync(dirname(DB_PATH), { recursive: true });

const client = createClient({ url: DB_FILE_NAME });

// SQLite defaults foreign_keys to OFF per connection; without this, cascades do
// not run. Not awaited: queries on one connection run in order, and a top-level
// await would keep this module out of CJS consumers.
void client.execute("PRAGMA foreign_keys = ON");

export const database = drizzle({ client });
