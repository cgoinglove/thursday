import { readGatewayCatalog } from "@/features/ai/model";
import type { GatewayModel } from "@/features/ai/model.schema";
import { TEXT_MODEL_PROVIDERS } from "@/features/ai/model.schema";
import { readConfig } from "@/features/config/config.query";
import { serverRoute } from "@/lib/protocol/server-route";
import { publicError } from "@/lib/public-error";

/**
 * Models reachable with the AI Gateway key; only the gateway exposes a list.
 * The answer is built in ai/model, where `callableRows` reads the same list.
 */
export const GET = serverRoute(async (): Promise<GatewayModel[]> => {
  const apiKey = await readConfig(
    TEXT_MODEL_PROVIDERS["vercel-ai-gateway"].apiKeyName,
  );
  if (!apiKey) publicError("Set the AI Gateway key first");

  return readGatewayCatalog(apiKey);
});
