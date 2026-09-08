import { readWorkspaceFolder } from "@/features/workspace/workspace.query";
import { serverRoute } from "@/lib/protocol/server-route";

/**
 * Read only; writes go through workspace.action. `?path=` selects the folder,
 * absent is the workspace root. Paths contain `/`, so not a segment. `?rows=`
 * is how many entries to return — the screen raises it to show more.
 */
export const GET = serverRoute(async (request) => {
  const query = new URL(request.url).searchParams;
  const rows = Number(query.get("rows"));
  return readWorkspaceFolder(
    query.get("path") ?? "",
    Number.isSafeInteger(rows) && rows > 0 ? rows : undefined,
  );
});
