import { readdirSync } from "node:fs";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/libsql/migrator";
import { APP_DIR } from "@/config";
import { database } from "./db";

const MIGRATIONS_TABLE = "__drizzle_migrations";

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
  if (!stale) return;

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
