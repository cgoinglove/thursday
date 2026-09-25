import { eq } from "drizzle-orm";
import { appEvents } from "@/app/api/events/app-event.server";
import { database } from "@/database/db";
import { configTable } from "@/database/tables";
import {
  CONFIG_GROUPS,
  CONFIG_KEYS,
  groupSatisfied,
  VOICE_GROUP_ID,
} from "./config.const";

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

/**
 * A key, sign-in or pick that Settings lists changed, whoever changed it: every open tab reads
 * them again (`config`). The table's other rows belong to a domain that reads its own.
 */
const changed = (key: string) => {
  if (CONFIG_KEYS.includes(key)) appEvents.emit({ type: "config" });
};

export async function writeConfig(key: string, value: string) {
  await database
    .insert(configTable)
    .values({ key, value })
    .onConflictDoUpdate({ target: configTable.key, set: { value } });
  changed(key);
}

export async function removeConfig(key: string) {
  await database.delete(configTable).where(eq(configTable.key, key));
  changed(key);
}

/** Whether a voice key exists (the keys group's `requireKeys`); decides call screen vs intro. */
export async function isCallable(): Promise<boolean> {
  const voice = CONFIG_GROUPS.find((group) => group.id === VOICE_GROUP_ID);
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
