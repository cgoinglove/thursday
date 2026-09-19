"use server";

import { z } from "zod";
import { startChatGptSignIn } from "@/features/ai/chatgpt";
import { LIVE_PROVIDER } from "@/features/ai/live.schema";
import { REACH_KEYS } from "@/features/reach/reach.schema";
import { keyRefusal } from "@/lib/live/live.server";
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
    if (entry?.signIn) {
      publicError(`${entry.label} takes a sign-in, not a key.`);
    }
    if (entry?.choices) {
      if (!acceptsChoice(entry, parsed.value)) {
        publicError("That is not one of the options.");
      }
    } else if (parsed.value.length < 8) {
      publicError("That does not look like a key");
    }
    // The key a call cannot open without is asked about before it is kept: a wrong one
    // would otherwise be found out at the first call, as a call that will not open
    if (parsed.key === LIVE_PROVIDER.apiKeyName) {
      const refused = await keyRefusal(parsed.value);
      if (refused)
        publicError(`${LIVE_PROVIDER.label} did not take it — ${refused}`);
    }
    await writeConfig(parsed.key, parsed.value);
    await tokenChanged(parsed.key);
  },
);

export const removeConfigAction = serverAction(async (key: unknown) => {
  const parsed = KeySchema.parse(key);
  await removeConfig(parsed);
  await tokenChanged(parsed);
});

/** A chat service's new token is a new bot to listen to, and none is nothing to listen for (features/reach). */
async function tokenChanged(key: string) {
  if (!Object.values(REACH_KEYS).some((keys) => keys.includes(key))) return;
  const { reachChannelOf, startReach } = await import("@/features/reach/reach");
  const channel = reachChannelOf(key);
  if (channel) await startReach(channel);
}

/**
 * Starts signing in to ChatGPT and returns the page to open (ai/chatgpt). The answer lands on
 * the server, which keeps the sign-in and signals the screen (`config`).
 */
export const startChatGptSignInAction = serverAction(async () =>
  startChatGptSignIn(),
);
