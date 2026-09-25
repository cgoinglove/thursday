"use client";

import { queryKey } from "@/app/api/query-key";
import { NavBadge } from "@/features/settings/components/setting-ui";
import type { SectionAlert } from "@/features/settings/settings.alert";
import { useServerRoute } from "@/lib/protocol/use-server-route";
import type { ReachStatus } from "../reach.schema";

/**
 * A service stopped: its token was turned away, and nothing written from that phone reaches
 * her until it is replaced. Trouble it is trying again after is the section's to say, not the
 * nav's. Kept fresh by ReachAsk, which loads with the app and hears every change.
 */
export function useReachAlert(): SectionAlert {
  const { data } = useServerRoute<ReachStatus>(queryKey.reach);
  return data?.channels.some((channel) => channel.refused) ? "red" : null;
}

/** The Phone section's dot. */
export function ReachBadge() {
  return useReachAlert() ? <NavBadge tone="red" /> : null;
}
