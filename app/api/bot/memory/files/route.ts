import { WORKSPACE_VIEW } from "@/config";
import { listBotMemory } from "@/features/bot/bot.memory";
import { serverRoute } from "@/lib/protocol/server-route";
import { publicError } from "@/lib/public-error";

/**
 * One bot's own memory, newest first. `?bot=` names it; read only — a file is
 * deleted through workspace.action, like any file a bot wrote.
 */
export const GET = serverRoute(async (request) => {
  const bot = new URL(request.url).searchParams.get("bot")?.trim();
  if (!bot) publicError("Which bot?");
  return listBotMemory(bot, WORKSPACE_VIEW.rows);
});
