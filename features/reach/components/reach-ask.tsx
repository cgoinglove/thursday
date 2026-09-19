"use client";

import { useEffect, useRef } from "react";
import { useAppEvent } from "@/app/api/events/app-event.client";
import { queryKey } from "@/app/api/query-key";
import { notify } from "@/components/ui/notify";
import { revalidate, useServerRoute } from "@/lib/protocol/use-server-route";
import { allowReachAction, declineReachAction } from "../reach.action";
import type { ReachStatus } from "../reach.schema";

/**
 * Someone wrote to the user's bot from a phone and is not let in yet: the screen asks, since
 * whoever writes to her can, through her, run things on this computer. Loaded with the app
 * and draws nothing of its own.
 */
export function ReachAsk() {
  const { data } = useServerRoute<ReachStatus>(queryKey.reach);
  useAppEvent({ reach: () => void revalidate(queryKey.reach) });

  /** The chat being asked about, so one ask is one dialog however often the status is read. */
  const asked = useRef<string | null>(null);
  const asking = data?.asking ?? null;
  useEffect(() => {
    if (!asking) {
      asked.current = null;
      return;
    }
    if (asked.current === asking.chat) return;
    asked.current = asking.chat;
    void notify
      .confirm({
        title: `Let ${asking.name} reach Thursday from a phone?`,
        description:
          "They wrote to your Telegram bot. Whoever you let in can talk to Thursday from there — and through her, start work on this computer. Only one person can be let in.",
        okText: "Allow",
        cancelText: "Not them",
      })
      .then((ok) =>
        ok ? allowReachAction(asking.chat) : declineReachAction(),
      );
  }, [asking]);

  return null;
}
