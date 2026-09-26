import { readKeyCredits } from "@/features/ai/model";
import { isCatalogProvider, type KeyCredits } from "@/features/ai/model.schema";
import { type RouteContext, serverRoute } from "@/lib/protocol/server-route";
import { publicError } from "@/lib/public-error";

/**
 * What is left on a catalog provider's key, null when none is set. Read by that key's row
 * in Settings › API keys and its key dialog; the answer is built in ai/model.
 */
export const GET = serverRoute<RouteContext<{ provider: string }>>(
  async (_request, { params }): Promise<KeyCredits | null> => {
    const { provider } = await params;
    if (!isCatalogProvider(provider))
      publicError(`${provider} has no credit to read`);
    return readKeyCredits(provider);
  },
);
