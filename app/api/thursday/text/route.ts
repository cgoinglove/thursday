import { streamTextCall } from "@/features/thursday/thursday.text";
import { serverRoute } from "@/lib/protocol/server-route";

/** One turn of a call in writing, streamed as she answers (thursday.text). */
export const POST = serverRoute(async (request) =>
  streamTextCall(await request.json(), request.signal),
);
