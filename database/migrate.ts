import { readdirSync } from "node:fs";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/libsql/migrator";
import { APP_DIR, DB_FILE_NAME } from "@/config";
import { database } from "./db";

const MIGRATIONS_TABLE = "__drizzle_migrations";

/**
 * A migration name recorded in the database that this build no longer ships is
 * data from before a release squashed its lineage into a fresh-looking first
 * migration (`CREATE TABLE IF NOT EXISTS`, run again). The table already exists
 * under its old columns, so `migrate` runs partway and dies on the first
 * statement that touches one — a raw SQLITE_ERROR with no hint of the cause.
 * Caught here so the fix reaches the user as one line instead of a stack trace.
 */
async function assertMigratable(migrationsFolder: string): Promise<void> {
  const known = new Set(readdirSync(migrationsFolder));
  const table = await database.all(
    sql`select name from sqlite_master where type = 'table' and name = ${MIGRATIONS_TABLE}`,
  );
  if (!table.length) return; // fresh database, nothing recorded yet

  const rows = await database.all<{ name: string | null }>(
    sql`select name from ${sql.identifier(MIGRATIONS_TABLE)}`,
  );
  const stale = rows.find((row) => row.name && !known.has(row.name));
  if (!stale) return;

  const path = DB_FILE_NAME.replace(/^file:/, "");
  throw new Error(
    `This database predates this build (migration "${stale.name}" no longer ships) and cannot be upgraded in place. ` +
      `Stop the server, remove it, and start again — this only touches call/task/memory history, not your workspace or skills:\n` +
      `  rm "${path}" "${path}-wal" "${path}-shm"`,
  );
}

/** Brings the DB up to this build's schema. Idempotent. */
export async function migrateDatabase() {
  // Migrations ship with the build (config APP_DIR), not with the user's data.
  const migrationsFolder = join(APP_DIR, "database/migrations");
  await assertMigratable(migrationsFolder);
  await migrate(database, { migrationsFolder });
}
