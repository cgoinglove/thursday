"use client";

import { Loader2 } from "lucide-react";
import { queryKey } from "@/app/api/query-key";
import type { MemoryTidyStatusView } from "@/features/memory/memory.schema";
import { NavBadge } from "@/features/settings/components/setting-ui";
import { useServerRoute } from "@/lib/protocol/use-server-route";

/** A tidy pass in progress draws a loader beside the nav row; a failed last pass, the red dot. */
export function MemoryBadge() {
  const { data } = useServerRoute<MemoryTidyStatusView>(queryKey.memoryTidy);
  if (data?.current) {
    return (
      <Loader2 className="size-3 shrink-0 animate-spin text-muted-foreground" />
    );
  }
  if (data?.last?.status === "failed") return <NavBadge tone="red" />;
  return null;
}
