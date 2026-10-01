"use client";

import { useEffect, useMemo, useState } from "react";
import { OfficeStage } from "@/features/bot/components/office-stage";
import {
  type OfficeThread,
  officeOf,
  sceneOf,
  watch,
} from "@/features/bot/office";
import type { Camera } from "@/features/bot/office.scene";
import type { ThreadView } from "@/features/bot/thread.store";
import { FileViewer } from "@/features/workspace/components/file-view";
import { toDate } from "@/lib/date-like";
import { cn } from "@/lib/utils";

/**
 * The thread open in the room, drawn as an office beside it where her face stands (bot-room):
 * its bots at their desks, the work walked across the floor as it happens, and once it is done,
 * the report at your counter and its files under the job's name. The room beside it is the
 * thread's words and box; pressing a bot here opens its tab there.
 * It fades in as it builds itself, and out while `leaving`, as her face comes back through it.
 * Another thread opened in its place builds its own office as this one sinks away.
 */
export function OfficeBackdrop({
  thread,
  leaving = false,
  onBot,
  onAnswer,
  camera,
  className,
}: {
  thread: ThreadView;
  /** On its way out: drawn a moment longer, fading, and out of reach (bot-room useLeaving). */
  leaving?: boolean;
  /** A bot pressed in the office: the room opens its tab (bot-room). */
  onBot?: (bot: string) => void;
  /** The head's ember line pressed: the room takes the user to what they are asked (bot-room). */
  onAnswer?: () => void;
  /** Where the office is seen from (office.scene Camera); a film sets its own. */
  camera?: Camera;
  className?: string;
}) {
  // The thread shown before this one, kept while it sinks away (office-sink)
  const [was, setWas] = useState<ThreadView | null>(null);
  const [shown, setShown] = useState(thread);
  if (shown.id !== thread.id) {
    setWas(shown);
    setShown(thread);
  } else if (shown !== thread) setShown(thread);
  useEffect(() => {
    if (!was) return;
    // kept until the new one has risen (120 + 300 ms); the old one stays gone meanwhile
    const out = window.setTimeout(() => setWas(null), 440);
    return () => window.clearTimeout(out);
  }, [was]);
  return (
    <div
      inert={leaving}
      className={cn(
        "flex animate-in fade-in duration-300",
        className,
        leaving &&
          "pointer-events-none opacity-0 transition-opacity duration-250 ease-in",
      )}
    >
      {/* Another thread builds its own office from the start; the one before keeps its own, the
          same element, as it sinks away */}
      <div className="relative flex min-h-0 min-w-0 flex-1">
        {(was ? [was, thread] : [thread]).map((one) =>
          one === was ? (
            <div
              key={one.id}
              inert
              className="pointer-events-none absolute inset-0 flex animate-office-sink"
            >
              <Office thread={one} camera={camera} />
            </div>
          ) : (
            <div
              key={one.id}
              className={cn(
                "flex min-h-0 min-w-0 flex-1",
                was && "animate-office-rise",
              )}
            >
              <Office
                thread={one}
                onBot={onBot}
                onAnswer={onAnswer}
                camera={camera}
              />
            </div>
          ),
        )}
      </div>
    </div>
  );
}

/**
 * One bot at its desk, on its page in Settings › Bots: the office of a thread it sits in, held on
 * its desk (office-stage `desk`), so it stands there as it does in the room — at work, asking, or
 * with its laptop shut once its part is back. Pressing it opens its last words over it.
 */
export function BotDesk({
  thread,
  bot,
  className,
}: {
  thread: ThreadView;
  bot: string;
  className?: string;
}) {
  return (
    <div className={cn("flex", className)}>
      {/* Another thread builds its own office, as the room's does */}
      <Office key={thread.id} thread={thread} desk={bot} />
    </div>
  );
}

function Office({
  thread,
  onBot,
  onAnswer,
  camera,
  desk,
}: {
  thread: ThreadView;
  onBot?: (bot: string) => void;
  onAnswer?: () => void;
  camera?: Camera;
  desk?: string;
}) {
  const start = toDate(thread.createdAt).getTime();
  const office = useMemo(() => officeOf(thread), [thread]);
  const memory = useWatched(office, start);
  const scene = useMemo(() => sceneOf(office, memory), [office, memory]);
  return (
    // what the counter holds opens as the room's files do; what is dropped here is the thread's,
    // as on the room (given-files roomDrop)
    <FileViewer>
      <OfficeStage
        scene={scene}
        start={start}
        label={thread.label}
        faces={thread.roster}
        from={thread.id}
        onBot={onBot}
        onAnswer={onAnswer}
        camera={camera}
        desk={desk}
        className="min-h-0 min-w-0 flex-1"
      />
    </FileViewer>
  );
}

/**
 * The office's memory of the thread (office `watch`), read again whenever the thread changes:
 * kept from one render to the next as React keeps a value read off a prop that changed.
 */
function useWatched(office: OfficeThread, start: number) {
  const [seen, setSeen] = useState(() => ({
    office,
    memory: watch(null, office, (Date.now() - start) / 1000),
  }));
  if (seen.office === office) return seen.memory;
  const next = {
    office,
    memory: watch(seen.memory, office, (Date.now() - start) / 1000),
  };
  setSeen(next);
  return next.memory;
}
