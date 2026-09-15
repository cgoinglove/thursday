import { z } from "zod";

export const RoomMessageSchema = z.object({
  to: z.string().trim().min(1),
  text: z.string().trim().min(1),
  kind: z.enum(["message", "question"]).default("message"),
  options: z.array(z.string().trim().min(1)).nullish(),
  replyTo: z.string().nullish(),
});

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
  options: z.string().array().optional(),
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
      kind: z.enum(["message", "question", "report", "interrupted"]),
      messageId: z.string().nullable(),
    })
    .array(),
});
export type RoomView = z.infer<typeof RoomViewSchema>;
