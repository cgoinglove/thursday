import { readWorkspaceFolder } from "@/features/workspace/workspace.query";
import { serverRoute } from "@/lib/protocol/server-route";

/**
 * Read only; writes go through workspace.action. `?path=` selects the folder,
 * absent is the workspace root. Paths contain `/`, so not a segment.
 */
export const GET = serverRoute(async (request) => {
  const path = new URL(request.url).searchParams.get("path") ?? "";
  return readWorkspaceFolder(path);
});
