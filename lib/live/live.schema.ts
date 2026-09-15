import { z } from "zod";

export const LIVE_MODEL = "gpt-live-1";
export const LIVE_BACKEND_MODEL = "gpt-5.6-luna";

/** Provider maxima for the startup `input`: how many messages, and their combined tokens. */
export const LIVE_INPUT = { messages: 128, tokens: 8_192 };

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

/** Earlier conversation seeded at startup. Live has no system role here; a trusted note is a developer message. */
export type LiveInput =
  | {
      type: "message";
      role: "developer";
      content: [{ type: "input_text"; text: string }];
    }
  | {
      type: "message";
      role: "user";
      content: [{ type: "input_text"; text: string }];
    }
  | {
      type: "message";
      role: "assistant";
      content: [{ type: "output_text"; text: string }];
    };

/** What `session.closed` confirmed: the provider's reason and the active seconds billed. */
export const LiveCloseSchema = z.object({
  reason: z.string().max(128),
  seconds: z.number().nonnegative().nullable(),
});
export type LiveClose = z.infer<typeof LiveCloseSchema>;
