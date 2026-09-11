"use client";

import { queryKey } from "@/app/api/query-key";
import type { Task } from "@/features/bot/bot.schema";
import { NavBadge } from "@/features/settings/components/setting-ui";
import type { SectionAlert } from "@/features/settings/settings.alert";
import { useServerRoute } from "@/lib/protocol/use-server-route";

/**
 * What the task list owes the user, from the inbox key both readings share:
 * jobs waiting on an answer and endings nobody has opened — amber, because both
 * wait on them — and among those, a failure, which is red. The inbox holds only
 * the latest INBOX_FINISHED endings, so every one counted has a row to open.
 */
export function useTaskReport() {
  const { data } = useServerRoute<Task[]>(queryKey.tasks);
  const tasks = data ?? [];
  const unread = (task: Task) =>
    (task.status === "done" || task.status === "failed") && !task.seen;
  return {
    owed: tasks.filter((task) => task.status === "waiting" || unread(task))
      .length,
    failed: tasks.some((task) => task.status === "failed" && unread(task)),
  };
}

export function useTaskAlert(): SectionAlert {
  const { owed, failed } = useTaskReport();
  if (failed) return "red";
  return owed > 0 ? "amber" : null;
}

/** The nav counts what is owed and dots a failure among it; the corner has room only for the worse of the two. */
export function TaskBadge() {
  const { owed, failed } = useTaskReport();
  return (
    <span className="flex items-center gap-1.5">
      {failed && <NavBadge tone="red" />}
      <NavBadge tone="amber" count={owed} />
    </span>
  );
}
