import * as z from "zod";
import { THREAD_STATUS_LIMIT } from "@/config";
import { TOOL_NAMES } from "@/features/ai/tools/tool-name";
import { THREAD_CONTINUE } from "@/features/bot/bot.schema";
import { RoomMessageSchema } from "@/features/bot/room.schema";

/** Tools for starting a thread, sending messages, and following work from the call. */
export const delegateSpec = {
  name: TOOL_NAMES.delegate,
  description:
    "Hand a job to a bot. Returns a receipt at once; the job runs in the background and its updates reach the conversation on their own.",
  parameters: z.object({
    bot: z.string().describe("A name from the bot list."),
    request: z
      .string()
      .describe(
        "The whole job. The bot cannot hear the call, so everything it needs goes here — names, paths, what the user actually asked for — in their own language and their own words: it is the only language the bot has, and whatever it writes comes back to them. **Their request, never your reading of it**: a condition, a caution or a smaller goal they did not say is how a job comes back as the wrong thing. When their words leave a real choice open, ask them on the call and put the answer here.",
      ),
    // Required: two jobs are often open at once and this prefixes every line of both on screen
    label: z
      .string()
      .describe(
        "Two or three words naming the job, in the user's language. Used on screen and said out loud.",
      ),
  }),
};

export const sendMessageSpec = {
  description:
    "Send a message to a participant or Thursday and receive a delivery receipt immediately. Mark a question for Thursday to request user input; ordinary messages to Thursday are notifications and need no answer.",
  parameters: RoomMessageSchema.extend({
    kind: RoomMessageSchema.shape.kind.describe(
      "Use question only when Thursday must obtain an answer from the user: it ends your turn, and you continue when the answer arrives. Use message for bot collaboration, progress updates and reports.",
    ),
    options: RoomMessageSchema.shape.options.describe(
      "With a question, offer concise answer choices when useful. Omit for an open-ended question; the user can always type their own answer.",
    ),
    to: z
      .string()
      .trim()
      .min(1)
      .describe("Choose a bot from the roster, or Thursday to reach the user."),
    text: z
      .string()
      .trim()
      .min(1)
      .describe(
        "Write the message and include the context the recipient needs.",
      ),
    replyTo: z
      .string()
      .nullish()
      .describe(
        "Use an incoming message ID to send an explicit reply; omit to start a new exchange. Your ordinary final text already replies to your current correspondent.",
      ),
  }),
};

/** The voice session's handle on a job already handed over. Run by the server, like `delegate` (load-tools). */
export const threadSpec = {
  name: TOOL_NAMES.thread,
  description: `List up to ${THREAD_STATUS_LIMIT} jobs, prioritizing running and waiting work before recent completed or failed jobs; inspect one job, answer it, cancel it, open it on the user's screen, or mark it seen — the same as the user opening it, which takes it off the work waiting on them.`,
  parameters: z.object({
    action: z.enum(["status", "answer", "cancel", "open", "seen"]),
    recipient: z
      .string()
      .nullish()
      .describe(
        "With answer, name the participant to receive it. Words to a participant waiting on its question answer that question; omit to reach the only open question, or the coordinator when none is open.",
      ),
    replyTo: z
      .string()
      .nullish()
      .describe(
        "With answer, use the message ID of the question being answered when several questions are open.",
      ),
    thread: z
      .string()
      .nullish()
      .describe(
        `Identify the job by label or ID. With status, omit or use null to list up to ${THREAD_STATUS_LIMIT} jobs, prioritizing open work and filling remaining places with recent endings; name one to read its full result and pending questions. With answer or open, omit to address the job that moved last.`,
      ),
    answer: z
      .string()
      .nullish()
      .describe(
        `With \`answer\`: what to tell the bot — the answer to its question, a course correction for a job still running, or what to do next on one that finished. \`${THREAD_CONTINUE}\` carries on a job that stopped before finishing, from where it was.`,
      ),
  }),
};
