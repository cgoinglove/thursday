import { join } from "node:path";
import { migrate } from "drizzle-orm/libsql/migrator";
import { APP_DIR } from "@/config";
import { database } from "./db";

/** Brings the DB up to this build's schema. Idempotent. */
export async function migrateDatabase() {
  await migrate(database, {
    // Migrations ship with the build (config APP_DIR), not with the user's data.
    migrationsFolder: join(APP_DIR, "database/migrations"),
  });
}
