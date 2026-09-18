"use client";

import { ChevronDown, X } from "lucide-react";
import { useState } from "react";
import { useAppEvent } from "@/app/api/events/app-event.client";
import { queryKey } from "@/app/api/query-key";
import { Button } from "@/components/ui/button";
import { FINISHED_NOTICE } from "@/config";
import type { Bot } from "@/features/bot/bot.schema";
import { BotMark } from "@/features/bot/components/bot-mark";
import { FileThumb } from "@/features/workspace/components/file-thumb";
import { viewKindOf } from "@/features/workspace/file-kind";
import { useServerRoute } from "@/lib/protocol/use-server-route";
import { cn } from "@/lib/utils";
import { FileViewer, useOpenFile } from "./file-view";

/**
 * What finished while the user was on the call, in the screen's left corner. A
 * job used to open its document by itself, over whatever was on screen; now the
 * corner says what is there and the user opens it. It keeps nothing: closing a
 * row or reloading clears it, and a result they have not read still waits in
 * the bot room.
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
  /** Workspace-relative, the one worth reading first at the head (bot.runner). */
  paths: string[];
};

function Notice() {
  const [rows, setRows] = useState<Finished[]>([]);
  const [open, setOpen] = useState(false);
  const { data: bots } = useServerRoute<Bot[]>(queryKey.bot);
  const openFile = useOpenFile();

  useAppEvent({
    // Asked for on a call (`thread` `open`): the file opens, where a finished job
    // only says it is there
    showFile: (event) =>
      openFile(
        event.paths[0],
        event.paths.filter((path) => viewKindOf(path) === "image"),
      ),
    artifact: (event) =>
      setRows((was) =>
        [
          {
            threadId: event.threadId,
            label: event.label,
            bot: event.bot,
            paths: event.paths,
          },
          // A job that finishes twice (picked back up, ended again) keeps one row
          ...was.filter((row) => row.threadId !== event.threadId),
        ].slice(0, FINISHED_NOTICE.rows),
      ),
  });

  if (!rows.length) return null;
  const drop = (threadId: string) =>
    setRows((was) => was.filter((row) => row.threadId !== threadId));

  return (
    <div className="absolute bottom-5 left-5 z-10 flex w-100 max-w-[calc(100vw-2.5rem)] flex-col overflow-hidden rounded-3xl bg-background/80 shadow-black/5 ring-1 ring-border/50 backdrop-blur-md animate-in fade-in slide-in-from-bottom-2 duration-300">
      {open && (
        <>
          <p className="flex items-center gap-2 px-3 pt-2 pb-1 font-mono text-[10px] tracking-wide text-muted-foreground">
            <span className="flex-1">
              {rows.length} new · made while you were away
            </span>
            <button
              type="button"
              onClick={() => setRows([])}
              className="rounded-md px-1 font-sans text-[11px] outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              Clear all
            </button>
          </p>
          <div className="flex flex-col gap-0.5 px-1.5 pb-1.5">
            {rows.map((row) => (
              <Row
                key={row.threadId}
                row={row}
                bot={bots?.find((one) => one.name === row.bot)}
                onOpen={() => {
                  const images = row.paths.filter(
                    (path) => viewKindOf(path) === "image",
                  );
                  openFile(row.paths[0], images);
                  drop(row.threadId);
                }}
                onClose={() => drop(row.threadId)}
              />
            ))}
          </div>
        </>
      )}

      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((was) => !was)}
        className={cn(
          "flex items-center gap-3 px-3 py-1.5 text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
          open && "border-t border-border/50",
        )}
      >
        <Pile paths={rows.map((row) => row.paths[0])} />
        <span className="min-w-0 flex-1 truncate text-[14px] tracking-[-0.15px]">
          {rows.length} new
        </span>
        <ChevronDown
          className={cn(
            "size-3.5 shrink-0 text-muted-foreground/60 transition-transform",
            open && "rotate-180",
          )}
        />
      </button>
    </div>
  );
}

function Row({
  row,
  bot,
  onOpen,
  onClose,
}: {
  row: Finished;
  bot: Bot | undefined;
  onOpen: () => void;
  onClose: () => void;
}) {
  const lead = row.paths[0];
  const name = lead.split("/").pop() ?? lead;
  const more = row.paths.length - 1;

  return (
    <div className="group/row relative flex items-center rounded-2xl transition-colors hover:bg-muted/70">
      <button
        type="button"
        onClick={onOpen}
        className="flex min-w-0 flex-1 items-center gap-2.5 rounded-2xl px-2 py-1.5 text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        <span className="relative shrink-0">
          <Thumb path={lead} size="row" />
          <BotMark
            size={14}
            seed={row.bot}
            color={bot?.icon?.color}
            shape={bot?.icon?.shape}
            outline={bot?.icon?.outline}
            paint={bot?.icon?.paint}
            notify={false}
            className="-right-0.5 -bottom-0.5 absolute rounded-md bg-background p-px"
          />
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-[14px] tracking-[-0.15px]">
            {name}
          </span>
          <span className="truncate text-[12px] text-muted-foreground">
            {row.bot} · {row.label}
            {more > 0 && ` · +${more} file${more === 1 ? "" : "s"}`}
          </span>
        </span>
      </button>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Dismiss"
        onClick={onClose}
        className="mr-1.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover/row:opacity-100 focus-visible:opacity-100"
      >
        <X />
      </Button>
    </div>
  );
}

/** A file's own face at the corner's two sizes (file-thumb draws it). */
function Thumb({ path, size }: { path: string; size: "row" | "pile" }) {
  return (
    <FileThumb
      path={path}
      glyph={size === "row" ? "size-4.5" : "size-3.5"}
      className={cn(
        "shrink-0",
        size === "row"
          ? "size-11 rounded-xl"
          : "size-7 rounded-lg ring-2 ring-background",
      )}
    />
  );
}

/** The folded pill's own glance: what the newest jobs left, shingled. */
function Pile({ paths }: { paths: string[] }) {
  return (
    <span className="flex shrink-0 items-center">
      {paths.slice(0, 3).map((path, at) => (
        <span key={path} className={cn("block", at > 0 && "-ml-2")}>
          <Thumb path={path} size="pile" />
        </span>
      ))}
    </span>
  );
}
