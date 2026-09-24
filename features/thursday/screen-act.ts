import type { ScreenAct } from "@/features/bot/thread.store";

/**
 * What an open call is told of something the user did on screen: a fact, never what to do
 * with it. She may have just read the question they answered and must not ask it again, and
 * a file put down is one she can be asked about. A spoken call hands it to her voice as
 * context (use-thursday); a call in writing puts it before her next step (use-text-call).
 */
export function screenActLine(act: ScreenAct): string {
  if (act.kind === "answered")
    return `The user sent a message on screen to ${act.recipient ?? "the coordinator"} in thread "${act.label}" (${act.id})${act.replyTo ? `, replying to ${act.replyTo}` : ""}: ${act.answer}. It has reached that participant.`;
  if (act.kind === "stopped")
    return `The user stopped thread "${act.label}" on screen. It is no longer running.`;
  return `The user put ${act.paths.length === 1 ? "a file" : `${act.paths.length} files`} down on screen, kept on this computer at ${act.paths.join(", ")}.`;
}
