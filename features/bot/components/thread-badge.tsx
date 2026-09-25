"use client";

import { queryKey } from "@/app/api/query-key";
import {
  isUnread,
  needsThreadReply,
  type Thread,
} from "@/features/bot/bot.schema";
import { NavBadge } from "@/features/settings/components/setting-ui";
import type { SectionAlert } from "@/features/settings/settings.alert";
import { useServerRoute } from "@/lib/protocol/use-server-route";

/**
 * What the thread list owes the user, from the inbox key both readings share:
 * jobs waiting on an answer and endings nobody has opened — the brand colour,
 * because both want them. Unread endings remain in the inbox until opened, so every one
 * counted has a row to open. A job never ends as a failure (a model that breaks
 * pauses it as waiting), so nothing here is red.
 */
export function useThreadReport() {
  const { data } = useServerRoute<Thread[]>(queryKey.threads);
  const threads = data ?? [];
  return {
    owed: threads.filter(
      (thread) => needsThreadReply(thread) || isUnread(thread),
    ).length,
  };
}

export function useThreadAlert(): SectionAlert {
  return useThreadReport().owed > 0 ? "brand" : null;
}

/** The nav counts what is owed. */
export function ThreadBadge() {
  return <NavBadge tone="brand" count={useThreadReport().owed} />;
}
