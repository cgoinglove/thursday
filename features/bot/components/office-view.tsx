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
import type { BotRef, ThreadView } from "@/features/bot/thread.store";
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
 * How a bot's desk is seen on its page: turned toward the front of the desk from the office's
 * diagonal, from the office's height, so its bot stands over the desk as it does there.
 */
const DESK_CAMERA: Camera = { yaw: 20, pitch: 40 };

/**
 * One bot alone at its desk, on its page in Settings › Bots: the office's own desk and face with
 * nothing around them (office-stage `desk`). It stands as it does in the job it is in now — at
 * work, waiting on you, paused — and with its laptop shut when it is in none.
 */
export function BotDesk({
  bot,
  thread,
  className,
}: {
  bot: BotRef;
  /** The job it is at work or waiting in now; none when it is free. */
  thread: ThreadView | null;
  className?: string;
}) {
  const key = thread
    ? (officeOf(thread).seats.get(bot.name)?.key ?? "none")
    : "none";
  // Read once per state: a desk with nothing moving keeps its clock still (office-stage)
  const [start] = useState(() => Date.now());
  const scene = useMemo(() => {
    const office: OfficeThread = {
      coord: bot.name,
      bots: [bot.name],
      events: [],
      seats: new Map([[bot.name, { key, waits: [], since: null }]]),
      owed: new Map(),
      states: new Map(),
      starts: new Map(),
      asking: new Set(),
      span: 0,
      steps: new Map(),
      status: thread?.status ?? "done",
      seen: true,
    };
    return sceneOf(office, watch(null, office, 0));
  }, [bot.name, key, thread?.status]);
  return (
    <div className={cn("flex", className)}>
      <OfficeStage
        scene={scene}
        start={start}
        label={thread?.label ?? bot.name}
        faces={[bot]}
        from={thread?.id ?? ""}
        camera={DESK_CAMERA}
        desk
        className="min-h-0 min-w-0 flex-1"
      />
    </div>
  );
}

function Office({
  thread,
  onBot,
  onAnswer,
  camera,
}: {
  thread: ThreadView;
  onBot?: (bot: string) => void;
  onAnswer?: () => void;
  camera?: Camera;
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
