import { readCatalog } from "@/features/ai/model";
import {
  type CatalogModel,
  isCatalogProvider,
} from "@/features/ai/model.schema";
import { type RouteContext, serverRoute } from "@/lib/protocol/server-route";
import { publicError } from "@/lib/public-error";

/**
 * Everything a catalog provider carries, every modality in one listing. It answers
 * unauthenticated, so the shelf reads before a key is set; only running a model
 * needs one. The answer is built in ai/model, where `callableRows` reads the same list.
 */
export const GET = serverRoute<RouteContext<{ provider: string }>>(
  async (_request, { params }): Promise<CatalogModel[]> => {
    const { provider } = await params;
    if (!isCatalogProvider(provider)) publicError(`${provider} has no catalog`);
    return readCatalog(provider);
  },
);
