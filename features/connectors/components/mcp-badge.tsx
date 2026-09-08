"use client";

import { queryKey } from "@/app/api/query-key";
import type { MCPServerSummary } from "@/features/connectors/mcp.schema";
import { NavBadge } from "@/features/settings/components/setting-ui";
import type { SectionAlert } from "@/features/settings/settings.alert";
import { useServerRoute } from "@/lib/protocol/use-server-route";

/** A server failed to start. How many is the section's business, not the nav's. */
export function useMcpAlert(): SectionAlert {
  const { data } = useServerRoute<MCPServerSummary[]>(queryKey.mcp);
  return data?.some((server) => server.lastError) ? "red" : null;
}

export function McpBadge() {
  return useMcpAlert() ? <NavBadge tone="red" /> : null;
}
