import { keepCallMemory } from "@/features/memory/call-memory";
import { endCall } from "@/features/thursday/thursday.query";
import { serverRoute } from "@/lib/protocol/server-route";

/**
 * A spoken call's row, ended by the tab that held it as that tab goes (use-thursday, on
 * `pagehide`). A server action is cut off with the page, and while another tab stays open
 * the sweep that closes a gone tab's calls never runs, so the row stayed live and no desktop
 * notice went out (bot.runner). A beacon is the one request a closing page still sends; it
 * carries the call's id and nothing else — the billed seconds are session.closed's to know.
 */
export const POST = serverRoute(async (request) => {
  const callId = (await request.text()).trim();
  // The page is gone; what the call said is still read once, on the server (memory/call-memory)
  if (callId && (await endCall(callId))) void keepCallMemory();
});
