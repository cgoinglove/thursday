import { readdirSync } from "node:fs";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/libsql/migrator";
import { APP_DIR } from "@/config";
import { database } from "./db";

const MIGRATIONS_TABLE = "__drizzle_migrations";

/**
 * The database was last opened by a newer build: it records a migration made after the
 * newest this one ships (their names start with when they were made). Nothing is wrong with
 * it, so it is not one to set aside — boot says so and exits with its own code (bin/database).
 */
export class NewerDatabase extends Error {}

/**
 * A migration name recorded in the database that this build no longer ships is
 * data from before a release squashed its lineage into a fresh-looking first
 * migration (`CREATE TABLE IF NOT EXISTS`, run again). The table already exists
 * under its old columns, so `migrate` runs partway and dies on the first
 * statement that touches one — a raw SQLITE_ERROR with no hint of the cause.
 * Checked first so the failure names that cause.
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
  if (!stale?.name) return;

  // An autostart left on an older version and an `npx` of a newer one share a data folder
  const newest = [...known]
    .filter((name) => /^\d{14}_/.test(name))
    .sort()
    .at(-1);
  if (newest && stale.name.slice(0, 14) > newest.slice(0, 14))
    throw new NewerDatabase(
      `It was last opened by a newer Thursday (it records "${stale.name}", made after this build's newest).`,
    );
  throw new Error(
    `It records migration "${stale.name}", which this build no longer ships.`,
  );
}

/** Brings the DB up to this build's schema. Idempotent. */
export async function migrateDatabase() {
  // Migrations ship with the build (config APP_DIR), not with the user's data.
  const migrationsFolder = join(APP_DIR, "database/migrations");
  await assertMigratable(migrationsFolder);
  await migrate(database, { migrationsFolder });
}
