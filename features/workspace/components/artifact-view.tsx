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
import {
  roomOpens,
  type ThreadView,
  useBotThreads,
} from "@/features/bot/thread.store";
import { FileThumb } from "@/features/workspace/components/file-thumb";
import {
  opensOnFinish,
  pathsIn,
  viewKindOf,
} from "@/features/workspace/file-kind";
import { toDate } from "@/lib/date-like";
import { unwrapResult } from "@/lib/protocol/result";
import { revalidate, useServerRoute } from "@/lib/protocol/use-server-route";
import { errorToString, plainText } from "@/lib/utils";
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
export type Finished = {
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

/**
 * Cards waved off in this browser, newest first, so a reload does not bring them back. Short:
 * a card also goes once its thread is read, which the server keeps.
 */
const DISMISSED_KEY = "thursday.corner-dismissed";
const DISMISSED_KEEP = 50;

function readDismissed(): string[] {
  try {
    const stored = JSON.parse(
      window.localStorage.getItem(DISMISSED_KEY) ?? "[]",
    );
    return Array.isArray(stored) ? stored : [];
  } catch {
    return [];
  }
}

function rememberDismissed(ids: string[]) {
  try {
    const kept = [
      ...ids,
      ...readDismissed().filter((id) => !ids.includes(id)),
    ].slice(0, DISMISSED_KEEP);
    window.localStorage.setItem(DISMISSED_KEY, JSON.stringify(kept));
  } catch {
    // blocked storage: the card comes back after a reload, which is only a card
  }
}

/**
 * A job finished while this page is not the one in front: the browser's own notification,
 * which brings Thursday forward when pressed — the card is waiting there. Nothing when the
 * page is in front (the card says it) or notifications were never allowed (see
 * `askToNotify`).
 */
function tellFinished(threadId: string, label: string, words: string) {
  if (typeof Notification === "undefined") return;
  if (Notification.permission !== "granted") return;
  if (document.visibilityState === "visible" && document.hasFocus()) return;
  try {
    const shown = new Notification(label, {
      body: words,
      tag: threadId,
      icon: "/icon.svg",
    });
    shown.onclick = () => {
      window.focus();
      shown.close();
    };
  } catch {
    // a browser that shows none from a page; the card and the room still have it
  }
}

/**
 * Asks once, in the browser's quiet way, whether this page may show a notification when a
 * job finishes out of sight. Called as a call is placed: the moment someone starts handing
 * out work, and never on load.
 */
export function askToNotify() {
  if (typeof Notification === "undefined") return;
  if (Notification.permission !== "default") return;
  void Notification.requestPermission().catch(() => undefined);
}

/** A finished job as a card, read off its row when no event brought it: after a reload. */
function cardOf(thread: ThreadView): Finished {
  const files = pathsIn(thread.outcome ?? "");
  const lead = files.findIndex(opensOnFinish);
  return {
    threadId: thread.id,
    label: thread.label,
    bot: thread.bot.name,
    words: plainText(thread.outcome ?? "").slice(0, FINISHED_NOTICE.words),
    paths:
      lead > 0 ? [files[lead], ...files.filter((_, at) => at !== lead)] : files,
  };
}

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
    finished: (event) => {
      tellFinished(event.threadId, event.label, event.words);
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
      );
    },
  });

  // What finished while the page was away, or before a reload, and is still unread: the
  // corner holds it until it is opened or waved off, as an event would have put it there
  const seeded = useRef(false);
  useEffect(() => {
    if (seeded.current || !threads.length) return;
    seeded.current = true;
    const dismissed = new Set(readDismissed());
    const waiting = threads
      .filter(
        (thread) =>
          thread.status === "done" && !thread.seen && !dismissed.has(thread.id),
      )
      .sort(
        (a, b) => toDate(b.updatedAt).getTime() - toDate(a.updatedAt).getTime(),
      );
    if (!waiting.length) return;
    setRows((was) =>
      [
        ...was,
        ...waiting
          .filter((thread) => !was.some((row) => row.threadId === thread.id))
          .map(cardOf),
      ].slice(0, FINISHED_NOTICE.rows),
    );
  }, [threads]);

  const drop = (threadId: string) => {
    rememberDismissed([threadId]);
    setRows((was) => was.filter((row) => row.threadId !== threadId));
  };

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
        <FinishedCard
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
            onClick={() => {
              rememberDismissed(rows.map((row) => row.threadId));
              setRows([]);
            }}
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
export function FinishedCard({
  row,
  bot,
  onOpen,
  onClose,
}: {
  row: Finished;
  /** Whose face it wears; only its icon is read. */
  bot: Pick<Bot, "icon"> | undefined;
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
