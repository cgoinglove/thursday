"use client";

import { queryKey } from "@/app/api/query-key";
import type { Task } from "@/features/bot/bot.schema";
import { NavBadge } from "@/features/settings/components/setting-ui";
import type { SectionAlert } from "@/features/settings/settings.alert";
import { useServerRoute } from "@/lib/protocol/use-server-route";

/** Jobs waiting on an answer. Shares the inbox key, so both readings are one fetch. */
function useWaitingTasks(): number {
  const { data } = useServerRoute<Task[]>(queryKey.tasks);
  return data?.filter((task) => task.status === "waiting").length ?? 0;
}

export function useTaskAlert(): SectionAlert {
  return useWaitingTasks() > 0 ? "amber" : null;
}

/** The nav says how many; the corner has no room for a number and says only that there are some. */
export function TaskBadge() {
  return <NavBadge tone="amber" count={useWaitingTasks()} />;
}
