"use client";

import { useEffect, useRef } from "react";
import { useAppEvent } from "@/app/api/events/app-event.client";
import { queryKey } from "@/app/api/query-key";
import { notify } from "@/components/ui/notify";
import { revalidate, useServerRoute } from "@/lib/protocol/use-server-route";
import { allowReachAction, declineReachAction } from "../reach.action";
import { REACH_LABEL, type ReachStatus } from "../reach.schema";

/**
 * Someone wrote to the user's bot from a phone and is not let in yet: the screen asks, since
 * whoever writes to her can, through her, run things on this computer. Loaded with the app
 * and draws nothing of its own.
 */
export function ReachAsk() {
  const { data } = useServerRoute<ReachStatus>(queryKey.reach);
  useAppEvent({ reach: () => void revalidate(queryKey.reach) });

  /** Who is being asked about, so one ask is one dialog however often the status is read. */
  const asked = useRef<string | null>(null);
  const from = data?.channels.find((channel) => channel.asking) ?? null;
  const asking = from?.asking ?? null;
  const name = from?.name ?? null;
  useEffect(() => {
    if (!asking || !name) {
      asked.current = null;
      return;
    }
    const key = `${name}:${asking.chat}`;
    if (asked.current === key) return;
    asked.current = key;
    void notify
      .confirm({
        title: `Let ${asking.name} reach Thursday from a phone?`,
        description: `They wrote to your ${REACH_LABEL[name]} bot. Whoever you let in can talk to Thursday from there — and through her, start work on this computer. One person can be let in.`,
        okText: "Allow",
        cancelText: "Not them",
      })
      .then((ok) =>
        ok ? allowReachAction(name, asking.chat) : declineReachAction(name),
      );
  }, [asking, name]);

  return null;
}
