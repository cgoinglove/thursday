import { findAllBots } from "@/features/bot/bot.query";
import { serverRoute } from "@/lib/protocol/server-route";

/** Read only; writes go through bot.action. */
export const GET = serverRoute(() => findAllBots());
