"use client";

import { queryKey } from "@/app/api/query-key";
import type { Bot } from "@/features/bot/bot.schema";
import { NavBadge } from "@/features/settings/components/setting-ui";
import type { SectionAlert } from "@/features/settings/settings.alert";
import { useServerRoute } from "@/lib/protocol/use-server-route";

/**
 * An empty roster is the one state where nothing can be handed over at all,
 * so it waits on the user. A loading answer reports nothing rather than
 * flashing a dot on every open.
 */
export function useBotAlert(): SectionAlert {
  const { data } = useServerRoute<Bot[]>(queryKey.bot);
  return data && data.length === 0 ? "amber" : null;
}

export function BotBadge() {
  return useBotAlert() ? <NavBadge tone="amber" /> : null;
}
