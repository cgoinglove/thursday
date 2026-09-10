import { streamMemoryEdit } from "@/features/memory/memory.edit";
import { serverRoute } from "@/lib/protocol/server-route";

/** An edit from the memory screen, streamed as it runs (memory.edit). */
export const POST = serverRoute(async (request) =>
  streamMemoryEdit(await request.json(), request.signal),
);
