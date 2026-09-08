import { findServerDetail } from "@/features/connectors/mcp.query";
import { RouteContext, serverRoute } from "@/lib/protocol/server-route";
import { publicError } from "@/lib/public-error";

/** Read only; writes go through mcp.action. */
export const GET = serverRoute(
  async (_request, { params }: RouteContext<{ name: string }>) => {
    const { name } = await params;
    const server = await findServerDetail(decodeURIComponent(name));
    if (!server) publicError("Server not found");
    return server;
  },
);
