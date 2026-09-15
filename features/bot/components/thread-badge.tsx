"use client";

import { queryKey } from "@/app/api/query-key";
import { needsThreadReply, type Thread } from "@/features/bot/bot.schema";
import { NavBadge } from "@/features/settings/components/setting-ui";
import type { SectionAlert } from "@/features/settings/settings.alert";
import { useServerRoute } from "@/lib/protocol/use-server-route";

/**
 * What the thread list owes the user, from the inbox key both readings share:
 * jobs waiting on an answer and endings nobody has opened — amber, because both
 * wait on them — and among those, a failure, which is red. Unread endings remain
 * in the inbox until opened, so every one counted has a row to open.
 */
export function useThreadReport() {
  const { data } = useServerRoute<Thread[]>(queryKey.threads);
  const threads = data ?? [];
  const unread = (thread: Thread) =>
    (thread.status === "done" || thread.status === "failed") && !thread.seen;
  return {
    owed: threads.filter((thread) => needsThreadReply(thread) || unread(thread))
      .length,
    failed: threads.some(
      (thread) => thread.status === "failed" && unread(thread),
    ),
  };
}

export function useThreadAlert(): SectionAlert {
  const { owed, failed } = useThreadReport();
  if (failed) return "red";
  return owed > 0 ? "amber" : null;
}

/** The nav counts what is owed and dots a failure among it; the corner has room only for the worse of the two. */
export function ThreadBadge() {
  const { owed, failed } = useThreadReport();
  return (
    <span className="flex items-center gap-1.5">
      {failed && <NavBadge tone="red" />}
      <NavBadge tone="amber" count={owed} />
    </span>
  );
}
