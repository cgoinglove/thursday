import { z } from "zod";

export const LIVE_MODEL = "gpt-live-1";
export const LIVE_BACKEND_MODEL = "gpt-5.6-luna";

/** Flat function declaration accepted by Responses delegation. */
export type ToolManifest = {
  name: string;
  description: string;
  parameters: ObjectSchema;
};

/** Original text and intervals survive display grouping and late delivery. */
export const LiveFragmentSchema = z.object({
  start: z.number().nonnegative(),
  end: z.number().nonnegative(),
  text: z.string(),
});
export type LiveFragment = z.infer<typeof LiveFragmentSchema>;

/** What `session.closed` confirmed: the provider's reason and the active seconds billed. */
export const LiveCloseSchema = z.object({
  reason: z.string().max(128),
  seconds: z.number().nonnegative().nullable(),
});
export type LiveClose = z.infer<typeof LiveCloseSchema>;
