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
  botThreads,
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
 * user opens it. Every job stands as the same card, with files or without.
 *
 * The corner keeps nothing of its own. It is the unread endings the server holds,
 * less the ones this browser waved off, so a reload brings back what is still
 * unread and a job that ended while the page was shut or the stream was down has
 * its card the moment the list arrives.
 *
 * Opening a card is reading it: the thread is marked seen, as opening it in the
 * room does, so the room stops calling it new and Thursday stops owing it on a
 * call. So is clearing the corner, which is the one way on this screen to have
 * done with a pile of them. Closing one card is not — that is this browser
 * waving it off. A thread read anywhere else takes its card away.
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
    // only says it is there. Hers to put up, so it takes itself down again
    showFile: (event) =>
      openFile(
        event.paths[0],
        event.paths.filter((path) => viewKindOf(path) === "image"),
        true,
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

  /**
   * Threads the list has shown ended. Until one is in here its card is held
   * whatever the list says: the event arrives the moment the row is written and
   * a read already in flight answers with the thread still running, which would
   * take the card straight back off again.
   */
  const ended = useRef(new Set<string>());

  /**
   * The corner is the unread endings the server knows about, less the ones this
   * browser waved off. An event puts a card up the moment a job ends — with the
   * files it actually wrote — and this is what keeps the corner right the rest
   * of the time: what finished while the page was away or the stream was down
   * gets its card, and what was read anywhere (the room, `thread_show`, another
   * tab) loses it.
   */
  useEffect(() => {
    if (!botThreads.primed()) return;
    for (const thread of threads) {
      if (thread.status === "done" || thread.status === "cancelled")
        ended.current.add(thread.id);
    }
    const dismissed = new Set(readDismissed());
    const waiting = threads
      .filter(
        (thread) =>
          thread.status === "done" && !thread.seen && !dismissed.has(thread.id),
      )
      .sort(
        (a, b) => toDate(b.updatedAt).getTime() - toDate(a.updatedAt).getTime(),
      );
    const unread = new Set(waiting.map((thread) => thread.id));
    setRows((was) => {
      const kept = was.filter(
        (row) => !ended.current.has(row.threadId) || unread.has(row.threadId),
      );
      const added = waiting
        .filter((thread) => !kept.some((row) => row.threadId === thread.id))
        .map(cardOf);
      const next = [...added, ...kept].slice(0, FINISHED_NOTICE.rows);
      const same =
        next.length === was.length &&
        next.every((row, at) => row.threadId === was[at].threadId);
      return same ? was : next;
    });
  }, [threads]);

  const drop = (threadId: string) => {
    rememberDismissed([threadId]);
    setRows((was) => was.filter((row) => row.threadId !== threadId));
  };

  if (!rows.length) return null;

  // One is drawn whole; the rest are a line each, so nothing is hidden behind anything
  const shown = rows.slice(0, FINISHED_NOTICE.shown);
  const listed = rows.slice(FINISHED_NOTICE.shown);

  const read = (threadIds: string[]) => {
    rememberDismissed(threadIds);
    setRows((was) => was.filter((row) => !threadIds.includes(row.threadId)));
    void markSeenAction(threadIds)
      .then(unwrapResult)
      .then(() => revalidate(queryKey.threads))
      .catch((cause) =>
        toast.add({
          type: "error",
          title:
            threadIds.length > 1
              ? "Could not mark the threads as read"
              : "Could not mark the thread as read",
          description: errorToString(cause),
        }),
      );
  };

  return (
    // The left end of the rail (thursday CallFoot). The cell holds their width and no
    // height: the stack stands on the rail and grows upward out of it, so however many
    // have piled up they take nothing from the room reading above.
    <div className="pointer-events-none relative col-start-1 row-start-2 w-82 max-w-full">
      {/* Newest at the foot, nearest the hand; reversed so a full corner scrolls from there.
          The padding is room for the cards' rings and shadows, which a scroll box would
          clip, and the negative margin puts their edge back on the rail. */}
      <div className="pointer-events-auto absolute bottom-0 left-0 -m-2 flex max-h-[80vh] w-82 max-w-full flex-col-reverse gap-2 overflow-y-auto p-2 scrollbar-none">
        {shown.map((row) => (
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
                read([row.threadId]);
              } else {
                // the room marks a thread seen as it opens it
                roomOpens.open(row.threadId);
                drop(row.threadId);
              }
            }}
            onClose={() => drop(row.threadId)}
          />
        ))}
        {/* Everything else it holds is a line: whose it is, what it was, and the faces of what
            it left. A pile of edges said there were more and nothing about them. */}
        {listed.map((row) => (
          <FinishedRow
            key={row.threadId}
            row={row}
            bot={bots?.find((one) => one.name === row.bot)}
            onOpen={() => {
              // the room marks a thread seen as it opens it
              roomOpens.open(row.threadId);
              drop(row.threadId);
            }}
            onClose={() => drop(row.threadId)}
          />
        ))}
        {rows.length > 1 && (
          <p className="flex shrink-0 items-center gap-2 px-1.5 font-mono text-[10px] text-muted-foreground">
            <span>{rows.length} new</span>
            <span className="flex-1" />
            {/* The corner reads what it draws and nothing else, which is why this is here at
                all: with every one of them on screen, reading the lot is a thing the user can
                mean. */}
            <button
              type="button"
              onClick={() => read(rows.map((one) => one.threadId))}
              className="rounded-md px-1 font-sans text-[11px] outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              Clear all
            </button>
          </p>
        )}
      </div>
    </div>
  );
}

/** How many of a row's files fit on its line before the rest become a number. */
const ROW_FACES = 3;

/**
 * One ending under the card: the bot, what it was, and small faces for what it left. Pressing it
 * opens the thread, which reads it; the ✕ only takes it off this screen.
 */
function FinishedRow({
  row,
  bot,
  onOpen,
  onClose,
}: {
  row: Finished;
  bot: Pick<Bot, "icon"> | undefined;
  onOpen: () => void;
  onClose: () => void;
}) {
  const more = row.paths.length - ROW_FACES;
  return (
    <div className="flex shrink-0 animate-in items-center gap-2 rounded-2xl bg-background py-1.5 pr-1.5 pl-2.5 shadow-black/8 shadow-md ring-1 ring-border fade-in slide-in-from-bottom-1 duration-300">
      <button
        type="button"
        onClick={onOpen}
        className="flex min-w-0 flex-1 items-center gap-2 rounded-lg text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        <BotMark
          size={18}
          seed={row.bot}
          color={bot?.icon?.color}
          shape={bot?.icon?.shape}
          outline={bot?.icon?.outline}
          paint={bot?.icon?.paint}
          notify={false}
          className="shrink-0"
        />
        <span className="min-w-0 flex-1 truncate text-[12.5px] leading-5">
          {row.label}
        </span>
        {row.paths.length > 0 && (
          <span className="flex shrink-0 items-center gap-1">
            {row.paths.slice(0, ROW_FACES).map((path) => (
              <FileThumb
                key={path}
                path={path}
                glyph="size-2.5"
                className="size-5 rounded-[6px] ring-1 ring-border"
              />
            ))}
            {more > 0 && (
              <span className="font-mono text-[10px] text-muted-foreground">
                +{more}
              </span>
            )}
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
