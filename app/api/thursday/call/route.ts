import { CALL_HISTORY_PAGE } from "@/config";
import { listCallHistory } from "@/features/thursday/thursday.query";
import { serverRoute } from "@/lib/protocol/server-route";

/**
 * Past calls, a page at a time — CallRecord[], newest call first, every turn
 * of each in speaking order. `?before=<ISO>` is the next page: the start time
 * of the oldest call already on screen (queryKey.callHistory).
 *
 * Read only. Nothing writes a call through a route but the beacon a closing tab sends to
 * end its own (call/end): a spoken call saves its turns as they are confirmed
 * (thursday.action), a call in writing and a phone as they are answered (thursday.text).
 */
export const GET = serverRoute((request) => {
  const before = new URL(request.url).searchParams.get("before");
  const cursor = before ? new Date(before) : null;
  return listCallHistory({
    before: cursor && !Number.isNaN(cursor.getTime()) ? cursor : null,
    limit: CALL_HISTORY_PAGE,
  });
});
