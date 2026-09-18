"use client";

import { X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useAppEvent } from "@/app/api/events/app-event.client";
import { queryKey } from "@/app/api/query-key";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { FINISHED_NOTICE } from "@/config";
import { markSeenAction } from "@/features/bot/bot.action";
import type { Bot } from "@/features/bot/bot.schema";
import { shortenPaths } from "@/features/bot/components/attachments";
import { BotMark } from "@/features/bot/components/bot-mark";
import { roomOpens, useBotThreads } from "@/features/bot/thread.store";
import { FileThumb } from "@/features/workspace/components/file-thumb";
import { viewKindOf } from "@/features/workspace/file-kind";
import { unwrapResult } from "@/lib/protocol/result";
import { revalidate, useServerRoute } from "@/lib/protocol/use-server-route";
import { errorToString } from "@/lib/utils";
import { FileViewer, useOpenFile } from "./file-view";

/**
 * What finished, in the screen's left corner. A job used to open its document by
 * itself, over whatever was on screen; now the corner says what is there and the
 * user opens it. Every job stands as the same card, with files or without. It
 * keeps nothing: closing a card or reloading clears it, and a result they have
 * not read still waits in the bot room.
 *
 * Opening a card is reading it: the thread is marked seen, as opening it in the
 * room does, so the room stops calling it new and Thursday stops owing it on a
 * call. Closing a card is not. A thread read anywhere else takes its card away.
 */
export function ArtifactView() {
  return (
    <FileViewer>
      <Notice />
    </FileViewer>
  );
}

/** One finished job, as the corner holds it. */
type Finished = {
  threadId: string;
  label: string;
  bot: string;
  /** The opening of its answer, plain text. */
  words: string;
  /** Workspace-relative, the one worth reading first at the head (bot.runner); empty for an answer in words alone. */
  paths: string[];
};

/** File faces a card draws before the rest fold into a count. */
const FACES_SHOWN = 4;

function Notice() {
  const [rows, setRows] = useState<Finished[]>([]);
  const { data: bots } = useServerRoute<Bot[]>(queryKey.bot);
  const threads = useBotThreads();
  const openFile = useOpenFile();

  useAppEvent({
    // Asked for on a call (`thread` `open`): the file opens, where a finished job
    // only says it is there
    showFile: (event) =>
      openFile(
        event.paths[0],
        event.paths.filter((path) => viewKindOf(path) === "image"),
      ),
    finished: (event) =>
      setRows((was) =>
        [
          {
            threadId: event.threadId,
            label: event.label,
            bot: event.bot,
            words: event.words,
            paths: event.paths,
          },
          // A job that finishes twice (picked back up, ended again) keeps one card
          ...was.filter((row) => row.threadId !== event.threadId),
        ].slice(0, FINISHED_NOTICE.rows),
      ),
  });

  const drop = (threadId: string) =>
    setRows((was) => was.filter((row) => row.threadId !== threadId));

  // Read somewhere else (the room, `thread_show`): the card goes. A card is armed
  // only once its thread was seen unread, since the thread list may still hold
  // the ending before this one when the event lands.
  const unread = useRef(new Set<string>());
  useEffect(() => {
    const gone: string[] = [];
    for (const row of rows) {
      const thread = threads.find((one) => one.id === row.threadId);
      if (!thread) continue;
      if (!thread.seen) unread.current.add(row.threadId);
      else if (unread.current.delete(row.threadId)) gone.push(row.threadId);
    }
    if (gone.length)
      setRows((was) => was.filter((row) => !gone.includes(row.threadId)));
  }, [rows, threads]);

  if (!rows.length) return null;

  const read = (threadId: string) => {
    drop(threadId);
    void markSeenAction([threadId])
      .then(unwrapResult)
      .then(() => revalidate(queryKey.threads))
      .catch((cause) =>
        toast.add({
          type: "error",
          title: "Could not mark the thread as read",
          description: errorToString(cause),
        }),
      );
  };

  return (
    // Newest at the foot, nearest the hand; reversed so a full corner scrolls from there.
    // The padding is room for the cards' rings and shadows, which a scroll box would clip.
    <div className="absolute bottom-3 left-3 z-10 flex max-h-[calc(100%-1.5rem)] w-82 max-w-[calc(100vw-1.5rem)] flex-col-reverse gap-2 overflow-y-auto p-2 scrollbar-none">
      {rows.map((row) => (
        <Card
          key={row.threadId}
          row={row}
          bot={bots?.find((one) => one.name === row.bot)}
          onOpen={(path) => {
            if (path) {
              openFile(
                path,
                row.paths.filter((one) => viewKindOf(one) === "image"),
              );
              read(row.threadId);
            } else {
              // the room marks a thread seen as it opens it
              roomOpens.open(row.threadId);
              drop(row.threadId);
            }
          }}
          onClose={() => drop(row.threadId)}
        />
      ))}
      {rows.length > 1 && (
        <p className="flex shrink-0 items-center px-1.5 font-mono text-[10px] text-muted-foreground">
          <span className="flex-1">{rows.length} new</span>
          <button
            type="button"
            onClick={() => setRows([])}
            className="rounded-md px-1 font-sans text-[11px] outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            Clear all
          </button>
        </p>
      )}
    </div>
  );
}

/**
 * Who, what, and how the answer opens; the files it named stand under the words,
 * as they do under a message in a thread. With files or without, it is one card.
 */
function Card({
  row,
  bot,
  onOpen,
  onClose,
}: {
  row: Finished;
  bot: Bot | undefined;
  /** A file's face opens that file; the rest of the card opens the first one, or the thread when there is none. */
  onOpen: (path: string | null) => void;
  onClose: () => void;
}) {
  const more = row.paths.length - FACES_SHOWN;

  return (
    <div className="flex shrink-0 animate-in gap-2.5 rounded-[20px] bg-background py-2.5 pr-2 pl-2.5 shadow-black/10 shadow-lg ring-1 ring-border fade-in slide-in-from-bottom-2 duration-300">
      <BotMark
        size={32}
        seed={row.bot}
        color={bot?.icon?.color}
        shape={bot?.icon?.shape}
        outline={bot?.icon?.outline}
        paint={bot?.icon?.paint}
        notify={false}
        className="shrink-0"
      />
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex items-start gap-1">
          <button
            type="button"
            onClick={() => onOpen(row.paths[0] ?? null)}
            className="flex min-w-0 flex-1 flex-col gap-1.5 rounded-lg text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            <span className="flex min-h-8 flex-col justify-center">
              <span className="truncate font-medium text-[14px] leading-5 tracking-[-0.15px]">
                {row.label}
              </span>
              <span className="truncate font-mono text-[10px] leading-[13px] text-muted-foreground">
                {row.bot}
              </span>
            </span>
            {row.words && (
              <span className="line-clamp-2 break-keep text-[12.5px] leading-normal text-muted-foreground">
                {shortenPaths(row.words)}
              </span>
            )}
          </button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Dismiss"
            onClick={onClose}
            className="shrink-0 text-muted-foreground"
          >
            <X />
          </Button>
        </div>
        {row.paths.length > 0 && (
          <div className="flex items-center gap-1.5 pt-0.5">
            {row.paths.slice(0, FACES_SHOWN).map((path) => (
              <button
                key={path}
                type="button"
                title={path.split("/").pop()}
                onClick={() => onOpen(path)}
                className="rounded-[10px] outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                <FileThumb
                  path={path}
                  glyph="size-4"
                  className="h-15 w-12 rounded-[10px] ring-1 ring-border"
                />
              </button>
            ))}
            {more > 0 && (
              <span className="px-1 font-mono text-[11px] text-muted-foreground">
                +{more}
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
