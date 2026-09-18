import { formatDistanceToNowStrict } from "date-fns";
import { PROMPT_LINE } from "@/config";
import { listThreadOverview } from "@/features/bot/thread.query";
import { toDate } from "@/lib/date-like";
import { clip } from "@/lib/utils";

/**
 * What work stands open as a call opens, put into the conversation once (thursday.action,
 * use-thursday) rather than into a prompt: a prompt is read as what is true for the whole
 * call, and this is true only at the moment it goes in — a job moves, ends or is started
 * from the screen while they talk. It is also what lets a request that carries earlier work
 * further reach that thread instead of opening a second one: the inbox relay carries only
 * what is news (a question, an ending nobody has seen, a progress line), so a job that
 * finished and was told about is invisible without this.
 *
 * Facts only, and no tool name: the voice is in the same conversation and holds no tool
 * that takes a thread. What to do with the list is the backend prompt's (thursday.prompt
 * Background work). Same rows and same order as `thread` `status` with nothing named.
 */
export async function loadCallStanding(): Promise<string | null> {
  const threads = await listThreadOverview();
  if (!threads.length) return null;

  const lines = threads.map((thread) => {
    const since = formatDistanceToNowStrict(toDate(thread.updatedAt), {
      addSuffix: true,
    });
    const asked = thread.room.questions[0];
    const state =
      thread.status === "waiting" && asked
        ? `waiting on the user since ${since} — ${asked.bot} asked: ${clip(asked.text, PROMPT_LINE.jobOutcome)}`
        : thread.status === "waiting"
          ? `stopped ${since}, not finished`
          : thread.status === "running"
            ? `running, last moved ${since}`
            : `${thread.status} ${since}`;
    return `- "${thread.label}" (${thread.id}) — ${thread.bot} — ${state}`;
  });

  return `[The threads as this call opened, open work first. They move while you talk.]\n${lines.join("\n")}`;
}
