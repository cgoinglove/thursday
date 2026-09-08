import { findAllServers } from "@/features/connectors/mcp.query";
import { serverRoute } from "@/lib/protocol/server-route";

/** Read only; writes go through mcp.action. */
export const GET = serverRoute(() => findAllServers());
