import { eq } from "drizzle-orm";
import { database } from "@/database/db";
import { configTable } from "@/database/tables";
import { CONFIG_GROUPS, groupSatisfied } from "./config.const";

/** Env var wins over the row the settings screen wrote. */
export async function readConfig(key: string) {
  const fromEnv = process.env[key]?.trim();
  if (fromEnv) return fromEnv;

  const [row] = await database
    .select({ value: configTable.value })
    .from(configTable)
    .where(eq(configTable.key, key));

  return row?.value.trim() || undefined;
}

export async function writeConfig(key: string, value: string) {
  await database
    .insert(configTable)
    .values({ key, value })
    .onConflictDoUpdate({ target: configTable.key, set: { value } });
}

export async function removeConfig(key: string) {
  await database.delete(configTable).where(eq(configTable.key, key));
}

/** Whether a voice key exists (the keys group's `requireKeys`); decides call screen vs intro. */
export async function isCallable(): Promise<boolean> {
  const voice = CONFIG_GROUPS.find((group) => group.id === "keys");
  if (!voice) return true;

  const set = await Promise.all(
    voice.entries.map(
      async (entry) =>
        [entry.key, Boolean(await readConfig(entry.key))] as const,
    ),
  );
  const has = new Map(set);
  return groupSatisfied(voice, (key) => has.get(key) ?? false);
}
