import { readFileThread } from "@/features/bot/thread.file";
import { readFileVersion } from "@/features/workspace/workspace.query";
import { serverRoute } from "@/lib/protocol/server-route";
import { publicError } from "@/lib/public-error";

/**
 * A file open on screen: where a note about it goes (bot/thread.file) and the version it is at,
 * so the screen can tell when it changed. `?path=` is workspace-relative; `?from=` the thread
 * the screen opened it from, when it knows one. Under `threads`, so a thread moving re-reads it;
 * the `files` signal re-reads it too. Read only: a note is sent through bot.action.
 */
export const GET = serverRoute(async (request) => {
  const query = new URL(request.url).searchParams;
  const path = query.get("path")?.trim();
  if (!path) publicError("Which file?");
  const [file, note] = await Promise.all([
    readFileVersion(path),
    readFileThread(path, query.get("from") || null),
  ]);
  return { file, note };
});
