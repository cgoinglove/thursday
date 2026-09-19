"use client";

import { useAppEvent } from "@/app/api/events/app-event.client";
import { queryKey } from "@/app/api/query-key";
import { useServerAction } from "@/lib/protocol/use-server-action";
import { revalidate, useServerRoute } from "@/lib/protocol/use-server-route";
import { cn, WAITING_INK } from "@/lib/utils";
import { forgetReachAction } from "../reach.action";
import type { ReachStatus } from "../reach.schema";

/**
 * Under the phone's token in Settings: which bot is listening, who is let in, and the way to
 * let them go. Says nothing until a token is set. What the service refused is red — the
 * token is wrong and nothing works; nobody let in yet is amber, since it waits on the user.
 */
export function ReachState() {
  const { data } = useServerRoute<ReachStatus>(queryKey.reach);
  useAppEvent({ reach: () => void revalidate(queryKey.reach) });
  const [forget, forgetting] = useServerAction(forgetReachAction, {
    onOk: () => revalidate(queryKey.reach),
  });

  if (!data || (!data.bot && !data.problem)) return null;
  const line = "px-1 pt-2 text-xs leading-5";

  if (data.problem && !data.bot)
    return <p className={cn(line, "text-destructive")}>{data.problem}</p>;
  if (!data.allowed)
    return (
      <p className={cn(line, WAITING_INK)}>
        Listening as {data.bot}. Write to it from your phone, then press Allow
        here.
      </p>
    );
  return (
    <p className={cn(line, "text-muted-foreground")}>
      Listening as {data.bot}. {data.allowed.name} is let in.{" "}
      <button
        type="button"
        disabled={forgetting}
        onClick={() => void forget().catch(() => {})}
        className="rounded-sm text-foreground underline underline-offset-4 outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50"
      >
        Let them go
      </button>
    </p>
  );
}
