import { readGatewayCredits } from "@/features/ai/model";
import type { GatewayCredits } from "@/features/ai/model.schema";
import { serverRoute } from "@/lib/protocol/server-route";

/**
 * What is left on the gateway key, null when none is set. Read by the gateway's
 * row in Settings › Keys and its key dialog; the answer is built in ai/model.
 */
export const GET = serverRoute(
  async (): Promise<GatewayCredits | null> => readGatewayCredits(),
);
