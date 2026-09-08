"use server";

import { z } from "zod";
import { serverAction } from "@/lib/protocol/server-action";
import { publicError } from "@/lib/public-error";
import { acceptsChoice, CONFIG_ENTRIES, CONFIG_KEYS } from "./config.const";
import { removeConfig, writeConfig } from "./config.query";

/** The catalogue is the allow list. */
const KeySchema = z.enum(CONFIG_KEYS as [string, ...string[]]);

/** Secrets are checked by length only; choices must be in the catalogue (`acceptsChoice`). */
export const setConfigAction = serverAction(
  async (key: unknown, value: unknown) => {
    const parsed = z
      .object({ key: KeySchema, value: z.string().trim().min(1) })
      .parse({ key, value });

    const entry = CONFIG_ENTRIES[parsed.key];
    if (entry?.choices) {
      if (!acceptsChoice(entry, parsed.value)) {
        publicError("That is not one of the options.");
      }
    } else if (parsed.value.length < 8) {
      publicError("That does not look like a key");
    }
    await writeConfig(parsed.key, parsed.value);
  },
);

export const removeConfigAction = serverAction(async (key: unknown) => {
  await removeConfig(KeySchema.parse(key));
});
