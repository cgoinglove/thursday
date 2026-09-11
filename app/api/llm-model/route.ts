import { readChatGptPlan } from "@/features/ai/chatgpt";
import {
  type AiProvider,
  TEXT_MODEL_PROVIDER_LIST,
} from "@/features/ai/model.schema";
import { readConfig } from "@/features/config/config.query";
import { serverRoute } from "@/lib/protocol/server-route";

/** Callable providers, whether each one's key is set, and the plan a sign-in is on. */
export const GET = serverRoute(async () =>
  Promise.all(
    TEXT_MODEL_PROVIDER_LIST.map(
      async (item): Promise<AiProvider> => ({
        id: item.id,
        label: item.label,
        apiKeyName: item.apiKeyName,
        suggestModels: item.suggestModels,
        hasKey: Boolean(await readConfig(item.apiKeyName)),
        ...(item.signIn && {
          signIn: true as const,
          plan: await readChatGptPlan(),
        }),
      }),
    ),
  ),
);
