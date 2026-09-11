"use client";

import { type ComponentProps, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { startChatGptSignInAction } from "@/features/config/config.action";
import { useServerAction } from "@/lib/protocol/use-server-action";

/** How often to look whether the sign-in window was closed, and how long to keep looking: as long as the server listens for its answer. */
const WINDOW_POLL_MS = 700;
const WINDOW_WATCH_MS = 10 * 60_000;

/**
 * Opens ChatGPT's sign-in in a window of its own. The answer lands on the server, which keeps it
 * and signals the screen (`config`); whoever draws this takes it away once signed in. Until then
 * the button waits, and stops waiting when the window is closed without finishing.
 */
export function ChatGptSignIn({
  variant,
}: {
  variant?: ComponentProps<typeof Button>["variant"];
}) {
  const [waiting, setWaiting] = useState(false);
  const watch = useRef<ReturnType<typeof setInterval> | null>(null);
  const stopWatching = () => {
    if (watch.current) clearInterval(watch.current);
    watch.current = null;
  };
  useEffect(() => stopWatching, []);

  const [start, starting] = useServerAction(startChatGptSignInAction, {
    onOk: (url) => {
      const popup = window.open(
        url,
        "thursday-chatgpt",
        "popup,width=520,height=720",
      );
      if (!popup) {
        toast.add({
          type: "error",
          title: "The sign-in window was blocked",
          description: "Allow pop-ups for this page, then try again",
        });
        return;
      }
      setWaiting(true);
      stopWatching();
      const deadline = Date.now() + WINDOW_WATCH_MS;
      watch.current = setInterval(() => {
        if (!popup.closed && Date.now() < deadline) return;
        stopWatching();
        setWaiting(false);
      }, WINDOW_POLL_MS);
    },
  });

  return (
    <Button
      variant={variant}
      loading={starting || waiting}
      onClick={() => start()}
    >
      Sign in with ChatGPT
    </Button>
  );
}
