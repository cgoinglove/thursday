"use client";

import { queryKey } from "@/app/api/query-key";
import {
  type ConfigStatus,
  isConfigUnreadable,
} from "@/features/config/config.const";
import { NavBadge } from "@/features/settings/components/setting-ui";
import type { SectionAlert } from "@/features/settings/settings.alert";
import { useServerRoute } from "@/lib/protocol/use-server-route";
import { REACH_KEYS, type ReachStatus } from "../reach.schema";

/**
 * A service stopped: its token was turned away, or can no longer be read (config.const
 * ConfigStatus `unreadable`), and nothing written from that phone reaches her until it is
 * replaced. Trouble it is trying again after is the section's to say, not the nav's. Kept fresh
 * by ReachAsk, which loads with the app and hears every change.
 */
export function useReachAlert(): SectionAlert {
  const { data } = useServerRoute<ReachStatus>(queryKey.reach);
  const { data: config } = useServerRoute<ConfigStatus[]>(queryKey.config);
  const lost = Object.values(REACH_KEYS)
    .flat()
    .some((key) => isConfigUnreadable(config, key));
  return data?.channels.some((channel) => channel.refused) || lost
    ? "red"
    : null;
}

/** The Phone section's dot. */
export function ReachBadge() {
  return useReachAlert() ? <NavBadge tone="red" /> : null;
}
