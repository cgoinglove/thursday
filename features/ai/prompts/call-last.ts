import { formatDistanceStrict } from "date-fns";
import { PROMPT_LINE, TEXT_CALL } from "@/config";
import { findLastCall } from "@/features/thursday/thursday.query";
import { clip } from "@/lib/utils";
import { callStamp } from "./prompt-helper";

/**
 * The call before this one, put into the conversation once as a call opens and ahead of
 * the greeting (thursday.action, use-thursday). The voice's prompt holds no earlier calls
 * — they are the backend's — so without this she opens every call as if it were the first
 * with this person. Like call-standing it is a fact of the moment and not a prompt line:
 * when it was, how long it ran, and the last words either side said, so her first words
 * can pick it up. Facts only; what to do with them is the opening's one clause
 * (live.prompt).
 */
export async function loadLastCall(): Promise<string | null> {
  const last = await findLastCall();
  if (!last) return null;
  const how = last.model === TEXT_CALL.model ? ", in writing" : "";
  // Under a minute it is a few words, and "0 seconds" says less than nothing
  const long = last.until.getTime() - last.startedAt.getTime() >= 60_000;
  const ran = long
    ? `, ${formatDistanceStrict(last.startedAt, last.until)}`
    : "";
  const lines = last.turns.map(
    (turn) =>
      `${turn.role === "user" ? "user" : "you"}: ${clip(turn.text.replace(/\s+/g, " ").trim(), PROMPT_LINE.jobOutcome)}`,
  );
  return `[The last call: ${callStamp(last.startedAt)}${how}${ran}. How it ended:]\n${lines.join("\n")}`;
}
