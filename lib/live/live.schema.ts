import { z } from "zod";

export const LIVE_MODEL = "gpt-live-1";
export const LIVE_BACKEND_MODEL = "gpt-6-luna";
/**
 * The voice the Codex CLI's /voice opens on a ChatGPT plan (codex-rs core
 * realtime_conversation.rs `DEFAULT_FRAMELESS_REALTIME_MODEL`): GPT-Live on the plan instead
 * of a key. It hands work to whoever opened the call rather than to a backend of its own
 * (live.plan, thursday.plan).
 */
export const LIVE_PLAN_MODEL = "gpt-live-1-codex";

/** Flat function declaration accepted by Responses delegation. */
export type ToolManifest = {
  name: string;
  description: string;
  parameters: ObjectSchema;
};

/**
 * The tools the backend's provider runs by itself, as the wire spells them: what a session
 * declares, and the output item each one reports back as. Another is a line here, its name
 * in what a call opens with, and a reader for its item (live.session).
 */
export const LIVE_HOSTED_TOOLS = {
  webSearch: { declare: { type: "web_search" }, item: "web_search_call" },
} as const;
export type LiveHostedTool = keyof typeof LIVE_HOSTED_TOOLS;

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
