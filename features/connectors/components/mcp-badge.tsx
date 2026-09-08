"use client";

import { queryKey } from "@/app/api/query-key";
import type { MCPServerSummary } from "@/features/connectors/mcp.schema";
import { NavBadge } from "@/features/settings/components/setting-ui";
import { useServerRoute } from "@/lib/protocol/use-server-route";

/** A dot when any server failed to start; how many is the section's business, not the nav's. */
export function McpBadge() {
  const { data } = useServerRoute<MCPServerSummary[]>(queryKey.mcp);
  const failed = data?.some((server) => server.lastError) ?? false;
  return failed ? <NavBadge tone="red" /> : null;
}
