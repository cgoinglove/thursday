import { z } from "zod";

export const RoomMessageSchema = z.object({
  to: z.string().trim().min(1),
  text: z.string().trim().min(1),
  kind: z.enum(["message", "question"]).default("message"),
  options: z.array(z.string().trim().min(1)).nullish(),
  replyTo: z.string().nullish(),
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

export const ROOM_THURSDAY = "Thursday";

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
      kind: z.enum(["message", "question", "report", "interrupted"]),
      messageId: z.string().nullable(),
    })
    .array(),
});
export type RoomView = z.infer<typeof RoomViewSchema>;
