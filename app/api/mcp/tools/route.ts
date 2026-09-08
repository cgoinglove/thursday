import { findAllTools } from "@/features/connectors/mcp.query";
import { serverRoute } from "@/lib/protocol/server-route";

/** Every tool across all servers; read by the bot form's pin picker. */
export const GET = serverRoute(() => findAllTools());
