import { stepMemoryEdit } from "@/features/memory/memory.edit";
import { serverRoute } from "@/lib/protocol/server-route";

/** One step of an edit from the memory screen. A route, not an action: a model step must not queue the screen's own writes behind it. */
export const POST = serverRoute(async (request) =>
  stepMemoryEdit(await request.json(), request.signal),
);
