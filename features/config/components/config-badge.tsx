"use client";

import { queryKey } from "@/app/api/query-key";
import {
  CONFIG_GROUPS,
  type ConfigStatus,
  groupSatisfied,
  isConfigSet,
} from "@/features/config/config.const";
import { NavBadge } from "@/features/settings/components/setting-ui";
import { useServerRoute } from "@/lib/protocol/use-server-route";

/** A dot while the app cannot hold a call: a required key group has nothing set. */
export function ConfigBadge() {
  const { data, isLoading } = useServerRoute<ConfigStatus[]>(queryKey.config);
  if (isLoading) return null;
  const isSet = (key: string) => isConfigSet(data, key);
  const unmet = CONFIG_GROUPS.some(
    (group) => group.section === "keys" && !groupSatisfied(group, isSet),
  );
  return unmet ? <NavBadge tone="amber" /> : null;
}
