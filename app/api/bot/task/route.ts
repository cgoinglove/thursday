import { TASK_HISTORY_PAGE } from "@/features/bot/bot.schema";
import { listInboxTasks, listTaskHistory } from "@/features/bot/task.query";
import { serverRoute } from "@/lib/protocol/server-route";

/**
 * Read only; start, answer and cancel go through bot.action. No params: the
 * inbox. `?history=1`: everything, with `&before=<ISO>` for the next page.
 */
export const GET = serverRoute((request) => {
  const query = new URL(request.url).searchParams;
  if (!query.get("history")) return listInboxTasks();

  const before = query.get("before");
  const cursor = before ? new Date(before) : null;
  return listTaskHistory({
    before: cursor && !Number.isNaN(cursor.getTime()) ? cursor : null,
    limit: TASK_HISTORY_PAGE,
  });
});
