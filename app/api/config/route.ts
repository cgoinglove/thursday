import {
  CONFIG_CHOICES,
  CONFIG_KEYS,
  type ConfigStatus,
} from "@/features/config/config.const";
import {
  configFromEnv,
  configState,
  readConfig,
} from "@/features/config/config.query";
import { serverRoute } from "@/lib/protocol/server-route";

/**
 * ConfigStatus[]: which declared keys are set. `value` is included only for
 * choice entries (config.const `choices`); secrets never leave the server. A
 * secret the data folder's key cannot open is unset and `unreadable`
 * (config.query configState), so its row asks for it again, saying why, rather
 * than taking the whole screen down. One the environment sets is `env`: Settings says so rather
 * than offer to replace or remove what it cannot.
 */
export const GET = serverRoute(() =>
  Promise.all(
    CONFIG_KEYS.map(async (key): Promise<ConfigStatus> => {
      const state = await configState(key);
      return {
        key,
        set: state === "set",
        ...(state === "unreadable" && { unreadable: true as const }),
        ...(configFromEnv(key) && { env: true as const }),
        ...(CONFIG_CHOICES[key] ? { value: await readConfig(key) } : {}),
      };
    }),
  ),
);
