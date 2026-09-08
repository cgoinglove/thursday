import { findAllNotes, findNoteByPath } from "@/features/memory/memory.query";
import { serverRoute } from "@/lib/protocol/server-route";
import { publicError } from "@/lib/public-error";

/**
 * Read only; writes go through memory.action. One MemoryNote[] page, `?offset=`
 * for the next. `?path=` returns one note: paths contain `/`, so not a segment.
 */
export const GET = serverRoute(async (request) => {
  const params = new URL(request.url).searchParams;

  const path = params.get("path");
  if (path) {
    const note = await findNoteByPath(path);
    if (!note) publicError("Note not found");
    return note;
  }

  const offset = Number(params.get("offset") ?? 0);
  return findAllNotes({ offset: Number.isFinite(offset) ? offset : 0 });
});
