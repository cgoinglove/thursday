"use client";

import { type ComponentProps, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { CHATGPT_SIGN_IN } from "@/config";
import { startChatGptSignInAction } from "@/features/config/config.action";
import { useLocale } from "@/hooks/use-locale";
import { useServerAction } from "@/lib/protocol/use-server-action";
import { settingsDictOf } from "@/messages";

/** How often to look whether the sign-in window was closed. It is looked for as long as the server listens for its answer (config CHATGPT_SIGN_IN.waitMs). */
const WINDOW_POLL_MS = 700;

/** Opens a sign-in address in the sign-in window, saying so when the browser blocks it. */
function openSignInWindow(
  url: string,
  t: { blockedTitle: string; blockedDesc: string },
): Window | null {
  const popup = window.open(
    url,
    "thursday-chatgpt",
    "popup,width=520,height=720",
  );
  if (!popup)
    toast.add({
      type: "error",
      title: t.blockedTitle,
      description: t.blockedDesc,
    });
  return popup;
}

/**
 * Opens ChatGPT's sign-in in a window of its own. The answer lands on the server, which keeps it
 * and signals the screen (`config`); whoever draws this takes it away once signed in. Until then
 * the button waits, and stops waiting when the window is closed without finishing.
 */
export function ChatGptSignIn({
  variant,
  size,
  className,
  label,
}: {
  variant?: ComponentProps<typeof Button>["variant"];
  size?: ComponentProps<typeof Button>["size"];
  className?: string;
  /** What the button says; the sign-in it starts is the same. */
  label?: string;
}) {
  const t = settingsDictOf(useLocale()).ai;
  const [waiting, setWaiting] = useState(false);
  const watch = useRef<ReturnType<typeof setInterval> | null>(null);
  const stopWatching = () => {
    if (watch.current) clearInterval(watch.current);
    watch.current = null;
  };
  useEffect(() => stopWatching, []);

  const [start, starting] = useServerAction(startChatGptSignInAction, {
    onOk: (url) => {
      const popup = openSignInWindow(url, t);
      if (!popup) return;
      setWaiting(true);
      stopWatching();
      const deadline = Date.now() + CHATGPT_SIGN_IN.waitMs;
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
      size={size}
      className={className}
      loading={starting || waiting}
      onClick={() => start()}
    >
      {label ?? t.signinBtn}
    </Button>
  );
}
