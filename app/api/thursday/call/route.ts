import { listCallHistory } from "@/features/thursday/thursday.query";
import { CALL_HISTORY_PAGE } from "@/features/thursday/thursday.schema";
import { serverRoute } from "@/lib/protocol/server-route";

/**
 * Past calls, a page at a time — CallRecord[], newest call first, every turn
 * of each in speaking order. `?before=<ISO>` is the next page: the start time
 * of the oldest call already on screen (queryKey.callHistory).
 *
 * Read only. Nothing writes a call through a route — the browser saves turns
 * as they are confirmed (thursday.action), and it is the only writer there is.
 */
export const GET = serverRoute((request) => {
  const before = new URL(request.url).searchParams.get("before");
  const cursor = before ? new Date(before) : null;
  return listCallHistory({
    before: cursor && !Number.isNaN(cursor.getTime()) ? cursor : null,
    limit: CALL_HISTORY_PAGE,
  });
});
