"use client";

import { useAppEvent } from "@/app/api/events/app-event.client";
import { queryKey } from "@/app/api/query-key";
import { useServerAction } from "@/lib/protocol/use-server-action";
import { revalidate, useServerRoute } from "@/lib/protocol/use-server-route";
import { cn, WAITING_INK } from "@/lib/utils";
import { forgetReachAction } from "../reach.action";
import {
  REACH_LABEL,
  type ReachChannelStatus,
  type ReachStatus,
} from "../reach.schema";

/**
 * Under the phone's keys in Settings, a line for each service that has its keys: which bot
 * is listening, who is let in, and the way to let them go. What the service refused is red
 * — the token is wrong and nothing works; nobody let in yet is amber, since it waits on the
 * user.
 */
export function ReachState() {
  const { data } = useServerRoute<ReachStatus>(queryKey.reach);
  useAppEvent({ reach: () => void revalidate(queryKey.reach) });
  if (!data?.channels.length) return null;
  return (
    <div className="pt-2">
      {data.channels.map((channel) => (
        <Line key={channel.name} channel={channel} />
      ))}
    </div>
  );
}

function Line({ channel }: { channel: ReachChannelStatus }) {
  const [forget, forgetting] = useServerAction(forgetReachAction, {
    onOk: () => revalidate(queryKey.reach),
  });
  const line = "px-1 text-xs leading-6";
  const label = REACH_LABEL[channel.name];

  if (channel.problem && !channel.bot)
    return (
      <p className={cn(line, "text-destructive")}>
        {label}: {channel.problem}
      </p>
    );
  if (!channel.bot)
    return (
      <p className={cn(line, "text-muted-foreground")}>{label}: connecting…</p>
    );
  if (!channel.allowed)
    return (
      <p className={cn(line, WAITING_INK)}>
        {label}: listening as {channel.bot}. Write to it from your phone, then
        press Allow here.
      </p>
    );
  return (
    <p className={cn(line, "text-muted-foreground")}>
      {label}: listening as {channel.bot}. {channel.allowed.name} is let in.{" "}
      <button
        type="button"
        disabled={forgetting}
        onClick={() => void forget(channel.name).catch(() => {})}
        className="rounded-sm text-foreground underline underline-offset-4 outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50"
      >
        Let them go
      </button>
    </p>
  );
}
