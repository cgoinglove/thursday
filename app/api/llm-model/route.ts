import {
  type AiProvider,
  TEXT_MODEL_PROVIDER_LIST,
} from "@/features/ai/model.schema";
import { readConfig } from "@/features/config/config.query";
import { serverRoute } from "@/lib/protocol/server-route";

/** Callable providers and whether each one's key is set. */
export const GET = serverRoute(async () =>
  Promise.all(
    TEXT_MODEL_PROVIDER_LIST.map(
      async (item): Promise<AiProvider> => ({
        id: item.id,
        label: item.label,
        apiKeyName: item.apiKeyName,
        suggestModels: item.suggestModels,
        hasKey: Boolean(await readConfig(item.apiKeyName)),
      }),
    ),
  ),
);
