"use client";

import { queryKey } from "@/app/api/query-key";
import type { Task } from "@/features/bot/bot.schema";
import { NavBadge } from "@/features/settings/components/setting-ui";
import { useServerRoute } from "@/lib/protocol/use-server-route";

/** How many jobs are waiting on an answer. Shares the inbox key, so it is the same fetch. */
export function TaskBadge() {
  const { data } = useServerRoute<Task[]>(queryKey.tasks);
  const waiting = data?.filter((task) => task.status === "waiting").length ?? 0;
  return <NavBadge tone="amber" count={waiting} />;
}
