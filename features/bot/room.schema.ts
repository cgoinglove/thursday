import { z } from "zod";

/** Server scheduling state, independent of whether a bot wrote a final sentence. */
export const WorkStateSchema = z.enum([
  "queued",
  "running",
  "waiting",
  "external",
  "paused",
  "done",
  "cancelled",
]);
export type WorkState = z.infer<typeof WorkStateSchema>;

export const RoomParticipantSchema = z.object({
  bot: z.string(),
  state: WorkStateSchema,
});
export const RoomQuestionSchema = z.object({
  id: z.string(),
  bot: z.string(),
  text: z.string(),
});

export const ROOM_THURSDAY = "Thursday";

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
      kind: z.enum(["question", "report", "interrupted"]),
      messageId: z.string().nullable(),
    })
    .array(),
});
export type RoomView = z.infer<typeof RoomViewSchema>;
