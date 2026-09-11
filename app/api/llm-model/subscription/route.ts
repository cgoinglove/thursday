import { readChatGptUsage } from "@/features/ai/chatgpt";
import type { SubscriptionUsage } from "@/features/ai/model.schema";
import { serverRoute } from "@/lib/protocol/server-route";

/**
 * How much of the GPT Subscription plan is used, null when nobody is signed in. Read by its
 * row in Settings › Keys and its sign-in dialog; the answer is built in ai/chatgpt.
 */
export const GET = serverRoute(
  async (): Promise<SubscriptionUsage | null> => readChatGptUsage(),
);
