import { z } from "zod";

export const RoomMessageSchema = z.object({
  to: z.string().trim().min(1),
  text: z.string().trim().min(1),
  /**
   * Why this recipient is being reached, for the user rather than for the recipient: a job
   * that pulled another bot in reads as one bot's work without it, since only the thread's
   * own bot reaches the screen. Kept by the tool call itself, so it needs no column.
   */
  why: z.string().trim().min(1),
  kind: z.enum(["message", "question"]).default("message"),
  options: z.array(z.string().trim().min(1)).nullish(),
});

/** Server scheduling state, independent of whether a bot wrote a final sentence. */
const WorkStateSchema = z.enum([
  "queued",
  "running",
  "waiting",
  "external",
  "paused",
  "done",
  "cancelled",
]);
export type WorkState = z.infer<typeof WorkStateSchema>;

const RoomParticipantSchema = z.object({
  bot: z.string(),
  state: WorkStateSchema,
});
const RoomQuestionSchema = z.object({
  id: z.string(),
  bot: z.string(),
  text: z.string(),
  options: z.string().array().optional(),
});

/** What a `thread_relay` row carries to Thursday. */
const RelayKindSchema = z.enum([
  "message",
  "question",
  "report",
  "interrupted",
]);
export type RelayKind = z.infer<typeof RelayKindSchema>;

export const ROOM_THURSDAY = "Thursday";

/**
 * The speaker the user's own words to a job are stored under (`thread_delivery.speaker`,
 * bot.runner answerThread), read back as theirs when the bot is handed them (room.query
 * deliveryText). Rows already hold it, so it does not change on its own.
 */
export const ROOM_USER = "The user";

/**
 * What a participant reads after why its turn broke off (room.query breakNote).
 * The screen draws only the why (thread.query linesOf).
 */
export const RESUME_CHECK =
  "Resume from the saved state; inspect any tool whose result is missing before repeating it.";

export const RoomViewSchema = z.object({
  participants: RoomParticipantSchema.array(),
  questions: RoomQuestionSchema.array(),
  deliveries: z
    .object({
      id: z.string(),
      bot: z.string(),
      text: z.string(),
      delivered: z.boolean(),
    })
    .array(),
  relays: z
    .object({
      id: z.number(),
      bot: z.string(),
      text: z.string(),
      kind: RelayKindSchema,
      messageId: z.string().nullable(),
    })
    .array(),
});
export type RoomView = z.infer<typeof RoomViewSchema>;
