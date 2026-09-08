import { serverRoute } from "@/lib/protocol/server-route";
import type { AppEvent } from "./app-event";
import { appEventStream, BOOT_ID } from "./app-event.server";

/** Server-sent events, one stream per browser. Sends `hello` on connect, then changes only. */
export const GET = serverRoute((request) =>
  Promise.resolve(
    appEventStream.respond(
      request.signal,
      async (): Promise<AppEvent[]> => [{ type: "hello", boot: BOOT_ID }],
    ),
  ),
);
