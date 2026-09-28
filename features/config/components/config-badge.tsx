"use client";

import { queryKey } from "@/app/api/query-key";
import {
  CONFIG_GROUPS,
  type ConfigStatus,
  groupSatisfied,
  isConfigSet,
} from "@/features/config/config.const";
import { REACH_KEYS } from "@/features/reach/reach.schema";
import { NavBadge } from "@/features/settings/components/setting-ui";
import type { SectionAlert } from "@/features/settings/settings.alert";
import { useServerRoute } from "@/lib/protocol/use-server-route";

/** The phone's tokens are Phone's to report (reach-badge), though they are keys too. */
const PHONE_KEYS: string[] = Object.values(REACH_KEYS).flat();

/**
 * The app cannot hold a call — a required key group has nothing set — or a key saved before can
 * no longer be read and waits to be entered again (config.const ConfigStatus `unreadable`).
 */
export function useConfigAlert(): SectionAlert {
  const { data, isLoading } = useServerRoute<ConfigStatus[]>(queryKey.config);
  if (isLoading) return null;
  const isSet = (key: string) => isConfigSet(data, key);
  const unmet = CONFIG_GROUPS.some(
    (group) => group.section === "keys" && !groupSatisfied(group, isSet),
  );
  const lost = Boolean(
    data?.some((entry) => entry.unreadable && !PHONE_KEYS.includes(entry.key)),
  );
  return unmet || lost ? "waiting" : null;
}

/** The API keys section's dot: a call has no key to run on, or a key is to be entered again. A dot, not a count. */
export function ConfigBadge() {
  return useConfigAlert() ? <NavBadge tone="waiting" /> : null;
}
