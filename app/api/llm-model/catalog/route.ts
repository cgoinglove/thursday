import { readGatewayCatalog } from "@/features/ai/model";
import type { GatewayModel } from "@/features/ai/model.schema";
import { serverRoute } from "@/lib/protocol/server-route";

/**
 * Everything the gateway carries, every modality in one listing. It answers
 * unauthenticated, so the shelf reads before a key is set; only running a model
 * needs one. The answer is built in ai/model, where `callableRows` reads the same list.
 */
export const GET = serverRoute(
  async (): Promise<GatewayModel[]> => readGatewayCatalog(),
);
