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
 * whoever writes to her can, through her, run things on this computer. A name is anyone's to
 * pick, so the question carries the code that phone was sent: the user lets in the phone in
 * their hand. It opens by itself, over whatever is being typed, so a key already on its way
 * lands on Not them. Loaded with the app and draws nothing of its own.
 */
export function ReachAsk() {
  const { data } = useServerRoute<ReachStatus>(queryKey.reach);
  useAppEvent({ reach: () => void revalidate(queryKey.reach) });

  /** The ask on screen: one dialog however often the status is read, closed once it moves on. */
  const shown = useRef<{ key: string; close: AbortController } | null>(null);
  const from = data?.channels.find((channel) => channel.asking) ?? null;
  const asking = from?.asking ?? null;
  const name = from?.name ?? null;
  const key = asking && name ? `${name}:${asking.chat}:${asking.code}` : null;
  useEffect(() => {
    if (shown.current?.key === key) return;
    // Answered in another tab, taken back, or someone new: the dialog for it goes
    shown.current?.close.abort();
    shown.current = null;
    if (!key || !asking || !name) return;
    const close = new AbortController();
    shown.current = { key, close };
    const ask = { chat: asking.chat, code: asking.code };
    void notify
      .confirm({
        title: `Let ${asking.name} reach Thursday from a phone?`,
        description: (
          <span className="line-clamp-2">
            {[REACH_LABEL[name], asking.name, asking.handle]
              .filter(Boolean)
              .join(" · ")}
            {asking.said && ` wrote “${asking.said}”`}
          </span>
        ),
        body: (
          <div className="grid gap-4">
            <div className="grid place-items-center gap-1.5 rounded-lg bg-muted p-4">
              {/* Spaced out to be read digit by digit, and set back so the spacing centres */}
              <span className="pl-[0.32em] font-mono text-3xl font-medium tracking-[0.32em]">
                {asking.code}
              </span>
              <span className="font-mono text-[11px] text-muted-foreground">
                the code their phone was sent
              </span>
            </div>
            <p className="text-sm text-muted-foreground">
              Allow only if the phone in your hand shows this code. Whoever you
              let in can talk to Thursday from there — and through her, start
              work on this computer.
            </p>
          </div>
        ),
        okText: "Allow",
        cancelText: "Not them",
        cautious: true,
        signal: close.signal,
      })
      .then((ok) => {
        // Closed from here because it was settled elsewhere: nothing is answered twice
        if (close.signal.aborted) return;
        return ok ? allowReachAction(name, ask) : declineReachAction(name, ask);
      });
  }, [key, asking, name]);

  return null;
}
