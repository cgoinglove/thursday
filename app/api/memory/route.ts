import { findAllNotes } from "@/features/memory/memory.query";
import { serverRoute } from "@/lib/protocol/server-route";

/** Read only; writes go through memory.action. One MemoryNote[] page, `?offset=` for the next. */
export const GET = serverRoute(async (request) => {
  const offset = Number(new URL(request.url).searchParams.get("offset") ?? 0);
  return findAllNotes({ offset: Number.isFinite(offset) ? offset : 0 });
});
