"use client";

import { queryKey } from "@/app/api/query-key";
import {
  CONFIG_GROUPS,
  type ConfigStatus,
  groupSatisfied,
  isConfigSet,
} from "@/features/config/config.const";
import { NavBadge } from "@/features/settings/components/setting-ui";
import type { SectionAlert } from "@/features/settings/settings.alert";
import { useServerRoute } from "@/lib/protocol/use-server-route";

/** The app cannot hold a call: a required key group has nothing set. */
export function useConfigAlert(): SectionAlert {
  const { data, isLoading } = useServerRoute<ConfigStatus[]>(queryKey.config);
  if (isLoading) return null;
  const isSet = (key: string) => isConfigSet(data, key);
  const unmet = CONFIG_GROUPS.some(
    (group) => group.section === "keys" && !groupSatisfied(group, isSet),
  );
  return unmet ? "amber" : null;
}

/** The API keys section's dot: a call has no key to run on. A dot, not a count. */
export function ConfigBadge() {
  return useConfigAlert() ? <NavBadge tone="amber" /> : null;
}
