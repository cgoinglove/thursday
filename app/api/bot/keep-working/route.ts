import { readKeepWorkingOn } from "@/features/bot/bot.query";
import { serverRoute } from "@/lib/protocol/server-route";

/** Whether running jobs carry on with no browser open. Read only; the write is bot.action. */
export const GET = serverRoute(() => readKeepWorkingOn());
