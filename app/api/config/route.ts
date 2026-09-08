import {
  CONFIG_CHOICES,
  CONFIG_KEYS,
  type ConfigStatus,
} from "@/features/config/config.const";
import { readConfig } from "@/features/config/config.query";
import { serverRoute } from "@/lib/protocol/server-route";

/**
 * ConfigStatus[]: which declared keys are set. `value` is included only for
 * choice entries (config.const `choices`); secrets never leave the server.
 */
export const GET = serverRoute(() =>
  Promise.all(
    CONFIG_KEYS.map(async (key): Promise<ConfigStatus> => {
      const value = await readConfig(key);
      return {
        key,
        set: Boolean(value),
        ...(CONFIG_CHOICES[key] ? { value } : {}),
      };
    }),
  ),
);
