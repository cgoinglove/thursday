import { readSet, readShelf } from "@/features/artifact/artifact.query";
import { serverRoute } from "@/lib/protocol/server-route";

/**
 * Read only; the one write goes through artifact.action. `?set=` opens one
 * folder's sheet, absent is the menu. `?rows=` is how many to return.
 */
export const GET = serverRoute(async (request) => {
  const query = new URL(request.url).searchParams;
  const rows = Number(query.get("rows"));
  const limit = Number.isSafeInteger(rows) && rows > 0 ? rows : undefined;
  const set = query.get("set");
  return set ? readSet(set, limit) : readShelf(limit);
});
