"use client";

import { ChevronRight } from "lucide-react";
import { useEffect, useState } from "react";
import { useAppEvent } from "@/app/api/events/app-event.client";
import { queryKey } from "@/app/api/query-key";
import { Button } from "@/components/ui/button";
import { ShinyText } from "@/components/ui/shiny-text";
import { Skeleton } from "@/components/ui/skeleton";
import { PATHS } from "@/config";
import {
  handFileAction,
  tellFileThreadAction,
} from "@/features/bot/bot.action";
import type { Bot, FileNote, FileThread } from "@/features/bot/bot.schema";
import {
  DraftComposer,
  Face,
  RecipientPicker,
} from "@/features/bot/components/thread-reply";
import { type BotRef, screenActs } from "@/features/bot/thread.store";
import { openSettings } from "@/features/settings/settings.store";
import { useServerAction } from "@/lib/protocol/use-server-action";
import { revalidate, useServerRoute } from "@/lib/protocol/use-server-route";
import { cn, errorToString, WAITING_INK } from "@/lib/utils";

/**
 * A note about a file, written under the file where it is open and sent to the thread that
 * made it (bot/thread.file), so asking for a change to what a bot made is done where it is
 * read rather than in the room. What would stop the note is said before anything is sent:
 * the server reads it with the file (`note`), and re-reads it as the thread moves.
 */

/** The composer's frame, as the room's reply has it (thread-reply). */
const BOX =
  "rounded-2xl bg-background py-1.5 pr-1.5 pl-3.5 ring-1 ring-border/80 transition-shadow focus-within:ring-ring/60";

/** Small words beside the box: the room's own hint size. */
const HINT = "px-1 text-[12.5px] leading-5 text-muted-foreground break-keep";

/**
 * Where a note about a file open on screen goes, and the version the file is at, as the server
 * reads them together (app/api/bot/thread/file). Only finished work carries a note, or a file
 * opened from its thread. A thread moving reads it again (it sits under `threads`), and so does
 * any shell's command or write (the `files` signal). `follow` moves the note to a thread that
 * took the file on from here.
 */
export function useFileNote(path: string | null, from: string | null) {
  const [thread, setThread] = useState(from);
  useEffect(() => setThread(from), [path, from]);
  const filed =
    path !== null &&
    (path.startsWith(`${PATHS.artifacts}/`) || thread !== null);
  const { data, error } = useServerRoute<FileNote>(
    filed && queryKey.fileNote(path, thread),
    // Said in the bar itself, where the note would have gone
    { onError: () => undefined },
  );
  useAppEvent({ files: () => void revalidate(queryKey.fileNotes) });
  return {
    filed,
    file: data?.file ?? null,
    note: data?.note,
    failure: error,
    follow: setThread,
  };
}

/** A bot as the screen draws it, from the roster when it is there. */
function botRef(bots: Bot[] | undefined, name: string): BotRef {
  return bots?.find((bot) => bot.name === name) ?? { name };
}

/** The thread a file came from, in the file's head: pressing it opens that thread. */
export function FileThreadChip({
  note,
  onOpen,
}: {
  note: FileThread | undefined;
  onOpen: (threadId: string) => void;
}) {
  const { data: bots } = useServerRoute<Bot[]>(queryKey.bot);
  if (!note || !("thread" in note)) return null;
  const { thread } = note;
  return (
    <button
      type="button"
      onClick={() => onOpen(thread.id)}
      aria-label={`Open the thread ${thread.label}`}
      className="inline-flex h-6.5 max-w-56 shrink-0 items-center gap-1.5 rounded-full bg-muted pr-2 pl-1.5 text-[12px] font-medium outline-none transition-colors hover:bg-muted-foreground/15 focus-visible:ring-3 focus-visible:ring-ring/50"
    >
      <Face bot={botRef(bots, thread.bot)} size={14} />
      <span className="min-w-0 truncate">{thread.label}</span>
      <ChevronRight className="size-3 shrink-0 text-muted-foreground" />
    </button>
  );
}

/** The bar under an open file: a note to its thread, or why none can go. */
export function FileNoteBar({
  path,
  note,
  failure,
  onThread,
  onOpenThread,
}: {
  /** Workspace-relative. */
  path: string;
  /** Undefined while it is read. */
  note: FileThread | undefined;
  failure: unknown;
  /** A thread took the file on, as a new job: the bar follows that one from here. */
  onThread: (threadId: string) => void;
  onOpenThread: (threadId: string) => void;
}) {
  // A thread whose bot was deleted: its file can still go to another, as a new job
  const [elsewhere, setElsewhere] = useState(false);

  if (failure)
    return (
      <p className="px-1 text-xs text-destructive">
        {`Could not tell where a note about this file would go: ${errorToString(failure)}`}
      </p>
    );
  if (!note) return <Skeleton className="h-10 w-full rounded-2xl" />;

  switch (note.state) {
    case "gone":
      return <p className={HINT}>This file is no longer on disk.</p>;
    case "asking":
      return (
        <div className="flex items-center gap-3 rounded-2xl py-2 pr-2 pl-3.5 ring-1 ring-waiting/40">
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className={cn("text-[12.5px] font-medium", WAITING_INK)}>
              {`${note.bot} is waiting on your answer`}
            </span>
            <span className="line-clamp-2 text-[13px] leading-snug break-keep wrap-anywhere">
              {note.question}
            </span>
          </div>
          <Button
            size="sm"
            className="shrink-0 rounded-full"
            onClick={() => onOpenThread(note.thread.id)}
          >
            Answer in the thread
          </Button>
        </div>
      );
    case "refused":
      if (elsewhere)
        return (
          <HandOver
            path={path}
            suggested={null}
            lead="What you send starts a new job, with this file."
            onThread={onThread}
          />
        );
      return (
        <div className="flex items-center gap-3 rounded-2xl bg-muted/60 py-2 pr-2 pl-3.5">
          <span className="min-w-0 flex-1 text-[13px] leading-snug break-keep wrap-anywhere">
            {note.why}
          </span>
          {note.reason === "deleted" ? (
            <Button
              size="sm"
              variant="outline"
              className="shrink-0 rounded-full"
              onClick={() => setElsewhere(true)}
            >
              Hand to another bot
            </Button>
          ) : (
            <Button
              size="sm"
              variant="outline"
              className="shrink-0 rounded-full"
              onClick={() => openSettings("keys")}
            >
              Open Settings
            </Button>
          )}
        </div>
      );
    case "none":
      return (
        <HandOver
          path={path}
          suggested={note.bot}
          lead={`${note.threadDeleted ? "This file's thread was deleted." : "This file isn't in any thread."} What you send starts a new one.`}
          onThread={onThread}
        />
      );
    case "open":
      return <ToThread path={path} note={note} />;
  }
}

/** A note to the thread that holds the file, addressed to whoever `thread.file` named. */
function ToThread({
  path,
  note,
}: {
  path: string;
  note: Extract<FileThread, { state: "open" }>;
}) {
  const { data: bots } = useServerRoute<Bot[]>(queryKey.bot);
  const [tell, telling] = useServerAction(tellFileThreadAction, {
    onOk: () => revalidate(queryKey.threads),
  });
  const to = botRef(bots, note.to);
  const running = note.status === "running";

  /** True once sent; a failure is toasted by the hook and the words stay. */
  const send = async (text: string) => {
    try {
      const done = await tell(path, text, note.thread.id);
      // As an answer in the room is: the open call must not ask for it again
      screenActs.announce({
        kind: "answered",
        id: done.id,
        label: done.label,
        answer: `About ${path}: ${text}`,
        recipient: done.to,
      });
      return true;
    } catch {
      return false;
    }
  };

  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      {note.paused ? (
        <p className={cn(HINT, "line-clamp-2")}>
          {`Paused: ${note.paused} Sending this picks it up again.`}
        </p>
      ) : running ? (
        <p className={HINT}>
          <ShinyText
            text={`${to.name} is working · it reads this before its next step`}
          />
        </p>
      ) : null}
      <DraftComposer
        threadId={note.thread.id}
        recipient={to.name}
        draftKey={`file:${path}`}
        send={send}
        busy={telling}
        claimsDrops={false}
        placeholder={
          running
            ? `What's off? ${to.name} reads this before its next step`
            : `Anything to change here? ${to.name} picks the thread back up`
        }
        label={`Note to ${to.name} about this file`}
        leading={
          <span className="mt-1 inline-flex h-5 shrink-0 items-center gap-1 self-start rounded-full bg-muted pr-2 pl-[3px] text-[12px] leading-none font-medium">
            <span className="pl-1 text-muted-foreground">To</span>
            <Face bot={to} size={14} />
            <span className="max-w-32 truncate">{to.name}</span>
          </span>
        }
        className={BOX}
      />
      <p className="px-1 font-mono text-[11px] text-muted-foreground">
        {`${to.name} reads it with this file named · the answer shows in the thread`}
      </p>
    </div>
  );
}

/** The file handed to a bot as a new job, when no thread there can take a note about it. */
function HandOver({
  path,
  suggested,
  lead,
  onThread,
}: {
  path: string;
  /** The bot whose folder holds it, when there is one. */
  suggested: string | null;
  lead: string;
  onThread: (threadId: string) => void;
}) {
  const { data: bots } = useServerRoute<Bot[]>(queryKey.bot);
  const [picked, setPicked] = useState<string | null>(null);
  const [hand, handing] = useServerAction(handFileAction, {
    onOk: (started) => {
      revalidate(queryKey.threads);
      onThread(started.id);
    },
  });
  if (!bots) return <Skeleton className="h-10 w-full rounded-2xl" />;
  const on = bots.filter((bot) => !bot.disabled);
  const current =
    on.find((bot) => bot.name === (picked ?? suggested)) ?? on[0] ?? null;
  if (!current)
    return (
      <p className={HINT}>
        No bot is switched on to hand it to. Turn one on in Settings › Bots.
      </p>
    );

  const send = async (text: string) => {
    try {
      await hand(current.name, path, text);
      return true;
    } catch {
      return false;
    }
  };

  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <p className={HINT}>{lead}</p>
      <DraftComposer
        threadId={`file:${path}`}
        recipient={current.name}
        send={send}
        busy={handing}
        claimsDrops={false}
        placeholder={`Hand this file to ${current.name} as a new job`}
        label={`New job for ${current.name} with this file`}
        leading={
          <RecipientPicker
            current={current}
            bots={on}
            disabled={handing}
            onPick={setPicked}
          />
        }
        className={BOX}
      />
    </div>
  );
}
