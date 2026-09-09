import { readBotNotesOn } from "@/features/bot/bot.query";
import { serverRoute } from "@/lib/protocol/server-route";

/** Whether bots keep their own instructions at all. Read only; the write is bot.action. */
export const GET = serverRoute(() => readBotNotesOn());
