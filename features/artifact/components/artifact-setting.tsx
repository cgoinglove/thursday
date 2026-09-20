"use client";

import {
  ChevronLeft,
  ExternalLink,
  FolderOpen,
  Images,
  Trash2,
} from "lucide-react";
import { type ReactNode, useState } from "react";
import { queryKey } from "@/app/api/query-key";
import { Button } from "@/components/ui/button";
import { notify } from "@/components/ui/notify";
import { Skeleton } from "@/components/ui/skeleton";
import { ARTIFACT_VIEW } from "@/config";
import { deleteArtifactAction } from "@/features/artifact/artifact.action";
import type {
  Artifact,
  ArtifactFile,
  ArtifactSet,
  ArtifactShelf,
} from "@/features/artifact/artifact.schema";
import type { Bot } from "@/features/bot/bot.schema";
import { BotMark } from "@/features/bot/components/bot-mark";
import {
  PICKED_ROW,
  SettingError,
  SettingFilter,
  SettingPanes,
  SettingPanesSkeleton,
  SettingRailNote,
} from "@/features/settings/components/setting-ui";
import { FileThumb } from "@/features/workspace/components/file-thumb";
import { FilePreview } from "@/features/workspace/components/file-view";
import { openFileAction } from "@/features/workspace/workspace.action";
import { shortAgo } from "@/lib/date-like";
import { useServerAction } from "@/lib/protocol/use-server-action";
import { revalidate, useServerRoute } from "@/lib/protocol/use-server-route";
import { cn, formatBytes } from "@/lib/utils";

/*
 * What the bots finished, listed the way they file it: each bot writes into
 * `artifacts/<bot>/`, and one entry there is one artifact. A skill writes
 * `<name>.html`, a job that makes a set writes `<name>/`.
 *
 * So this is not Workspace pointed at one folder. There is no tree here: the
 * menu is newest-first under each bot's face, and a folder does not open into
 * another listing — it opens as a sheet of what it holds, which is the thing a
 * set of pictures is for. Browsing a tree is Workspace's job.
 */

/** The row picked in the menu, and the file being read inside it. */
type Reading = { row: Artifact; file: ArtifactFile | null };

export function ArtifactSetting() {
  const [reading, setReading] = useState<Reading | null>(null);
  const [filter, setFilter] = useState("");
  /** Whose shelf is up: a bot's name, `null` for what sits loose, `undefined` for everyone's. */
  const [of, setOf] = useState<string | null | undefined>(undefined);
  const [rows, setRows] = useState(ARTIFACT_VIEW.rows);

  const { data, isLoading, error } = useServerRoute<ArtifactShelf>(
    queryKey.artifactShelf(rows),
    { keepPreviousData: true },
  );

  const { data: bots } = useServerRoute<Bot[]>(queryKey.bot);
  const [reveal] = useServerAction(openFileAction);

  if (isLoading) return <SettingPanesSkeleton />;
  if (error) return <SettingError message={error.message} />;

  const entries = data?.entries ?? [];
  const total = data?.total ?? 0;
  const needle = filter.trim().toLowerCase();
  const shown = entries.filter(
    (entry) =>
      (of === undefined || entry.bot === of) &&
      (!needle ||
        entry.name.toLowerCase().includes(needle) ||
        entry.bot?.toLowerCase().includes(needle)),
  );

  // A fresh row when the open one is still listed, so a rewrite shows through
  const picked =
    entries.find((entry) => entry.path === reading?.row.path) ?? reading?.row;

  return (
    <SettingPanes
      footer={
        <>
          <SettingRailNote>
            <span className="font-mono">
              <span className="font-medium text-foreground">finished</span>
              {` · ${countLine(entries, total, data?.files ?? 0)}`}
            </span>
          </SettingRailNote>
          <Button
            variant="outline"
            size="sm"
            onClick={() => reveal("artifacts")}
          >
            <FolderOpen />
            Reveal folder
          </Button>
        </>
      }
      left={
        <div className="flex flex-col py-2">
          <SettingFilter
            value={filter}
            onChange={setFilter}
            placeholder="Filter files"
            className="mx-2 mb-1.5 w-auto"
          />

          {/* Bots only: with every file listed here the bots themselves scrolled out of sight */}
          <BotRow
            label="Everyone"
            count={entries.length}
            active={of === undefined}
            onPick={() => {
              setOf(undefined);
              setReading(null);
            }}
          />
          {groupByBot(entries).map(({ bot, rows }) => (
            <BotRow
              key={bot ?? ""}
              label={bot ?? "Unsorted"}
              mark={
                bot ? (
                  <BotMark
                    size={18}
                    seed={bot}
                    {...markOf(bot, bots)}
                    notify={false}
                    className="shrink-0"
                  />
                ) : undefined
              }
              count={rows.length}
              active={of === bot}
              onPick={() => {
                setOf(bot);
                setReading(null);
              }}
            />
          ))}

          {total > entries.length && (
            <button
              type="button"
              onClick={() => setRows(rows + ARTIFACT_VIEW.rows)}
              className="mx-2 mt-2 rounded-md px-2 py-1.5 text-left font-mono text-[11px] text-muted-foreground outline-none hover:bg-muted/60 hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset"
            >
              {/* The filter only sees loaded rows, so the count says what it is not searching */}
              {`Show ${Math.min(ARTIFACT_VIEW.rows, total - entries.length)} more of ${total.toLocaleString("en")}`}
            </button>
          )}
        </div>
      }
      right={
        picked ? (
          <Reader
            key={picked.path}
            row={picked}
            file={reading?.file ?? null}
            onOpen={(file) => setReading({ row: picked, file })}
            onBack={() => setReading({ row: picked, file: null })}
            onGone={() => setReading(null)}
            onShelf={() => setReading(null)}
          />
        ) : shown.length > 0 ? (
          <Shelf
            entries={shown}
            bots={bots}
            onPick={(row) => setReading({ row, file: null })}
          />
        ) : (
          <Nothing empty={total === 0} />
        )
      }
    />
  );
}

/**
 * Rows under the bot that made them, in the order the rows came: newest first,
 * so the bot that handed something over last is on top. Loose rows are one group.
 */
function groupByBot(
  entries: Artifact[],
): { bot: string | null; rows: Artifact[] }[] {
  const groups = new Map<string | null, Artifact[]>();
  for (const entry of entries) {
    const rows = groups.get(entry.bot) ?? [];
    rows.push(entry);
    groups.set(entry.bot, rows);
  }
  return [...groups].map(([bot, rows]) => ({ bot, rows }));
}

/** Icon from the bot list; the row only carries the name. A bot that is gone draws its seed alone. */
function markOf(name: string, bots?: Bot[]) {
  const icon = bots?.find((bot) => bot.name === name)?.icon;
  return {
    color: icon?.color,
    shape: icon?.shape,
    outline: icon?.outline,
    paint: icon?.paint,
  };
}

/** `4 results · 34 files`, and what is not on screen. Counts rows, so it is free. */
function countLine(shown: Artifact[], total: number, files: number): string {
  if (total === 0) return "empty";
  const head =
    total > shown.length
      ? `${shown.length} of ${total.toLocaleString("en")} results`
      : `${total} ${total === 1 ? "result" : "results"}`;
  return files > total ? `${head} · ${files.toLocaleString("en")} files` : head;
}

/** One row of the left pane: whose shelf the right pane shows. */
function BotRow({
  label,
  mark,
  count,
  active,
  onPick,
}: {
  label: string;
  mark?: ReactNode;
  count: number;
  active: boolean;
  onPick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onPick}
      className={cn(
        "mx-2 flex h-9 items-center gap-2 rounded-md px-2 text-left text-[13px] outline-none focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset",
        active
          ? cn(PICKED_ROW, "font-medium")
          : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
      )}
    >
      {mark ?? <Images className="size-4 shrink-0" />}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <span className="shrink-0 font-mono text-[10.5px] text-muted-foreground/70 tabular-nums">
        {count}
      </span>
    </button>
  );
}

/** The right pane: a file read, or a set laid out as a sheet. */
function Reader({
  row,
  file,
  onOpen,
  onBack,
  onGone,
  onShelf,
}: {
  row: Artifact;
  /** The file being read inside a set; null reads the row itself. */
  file: ArtifactFile | null;
  onOpen: (file: ArtifactFile) => void;
  onBack: () => void;
  onGone: () => void;
  /** Back to the shelf it was picked from. */
  onShelf: () => void;
}) {
  const [reveal] = useServerAction(openFileAction);
  const [remove, removing] = useServerAction(deleteArtifactAction, {
    okMessage: "Deleted",
    onOk: () => {
      revalidate(queryKey.artifacts);
      if (file) onBack();
      else onGone();
    },
  });

  // A lone file is read directly; a set is read through one of its own
  const open: { path: string; bytes: number; at: string | Date } | null = file
    ? { path: file.path, bytes: file.bytes, at: file.at }
    : row.kind === "file"
      ? { path: row.path, bytes: row.bytes, at: row.at }
      : null;

  const confirmRemove = async (path: string) => {
    const confirmed = await notify.confirm({
      title: `Delete ${path.split("/").pop()}?`,
      description: open
        ? "It is deleted from disk for good."
        : "The folder and everything in it are deleted from disk for good.",
      okText: "Delete",
      destructive: true,
    });
    if (confirmed) remove(path);
  };

  return (
    <>
      <div className="flex h-11 shrink-0 items-center gap-3 border-b border-border/60 px-6">
        <button
          type="button"
          onClick={file ? onBack : onShelf}
          className="-ml-1 flex shrink-0 items-center gap-1 rounded-md px-1.5 py-1 font-mono text-[11px] text-muted-foreground outline-none hover:bg-muted/60 hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <ChevronLeft className="size-3" />
          {file ? row.name : "Shelf"}
        </button>
        <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-foreground">
          {open ? (open.path.split("/").pop() ?? row.name) : row.name}
        </span>
        <span className="shrink-0 font-mono text-[11px] text-muted-foreground/70">
          {open
            ? `${formatBytes(open.bytes)} · ${shortAgo(open.at)}`
            : `${row.count} ${row.count === 1 ? "file" : "files"} · ${shortAgo(row.at)}`}
        </span>
        {open && (
          <a
            href={queryKey.fileView(open.path)}
            target="_blank"
            rel="noreferrer"
            aria-label="Open in a new tab"
            className="grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground outline-none transition-colors hover:bg-muted/60 hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            <ExternalLink className="size-4" />
          </a>
        )}
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label="Reveal in the file manager"
          className="text-muted-foreground"
          onClick={() => reveal(open?.path ?? row.path)}
        >
          <FolderOpen />
        </Button>
        {/* set apart from Reveal beside it, and red on the way in: the file goes from disk */}
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label="Delete"
          loading={removing}
          className="ml-1.5 text-muted-foreground hover:text-destructive"
          onClick={() => confirmRemove(open?.path ?? row.path)}
        >
          <Trash2 />
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {open ? (
          <FilePreview path={open.path} bytes={open.bytes} />
        ) : (
          <SetSheet path={row.path} onOpen={onOpen} />
        )}
      </div>
    </>
  );
}

/**
 * A set laid out as a sheet — the reason a folder is one row. Its own read, so
 * a set nobody opens costs one `readdir` for its count and nothing more.
 */
function SetSheet({
  path,
  onOpen,
}: {
  path: string;
  onOpen: (file: ArtifactFile) => void;
}) {
  const { data, isLoading, error } = useServerRoute<ArtifactSet>(
    queryKey.artifactSet(path, ARTIFACT_VIEW.setFiles),
  );

  if (isLoading) {
    return (
      <div className="grid grid-cols-4 gap-3 p-5">
        {Array.from({ length: 8 }, (_, at) => (
          <Skeleton key={at} className="aspect-4/3 w-full rounded-xl" />
        ))}
      </div>
    );
  }
  if (error) return <SettingError message={error.message} />;

  const files = data?.files ?? [];
  if (files.length === 0) {
    return (
      <p className="p-5 text-xs text-muted-foreground/60">
        Nothing in here the app can open.
      </p>
    );
  }

  return (
    <div className="p-5">
      <div className="grid grid-cols-4 gap-3">
        {files.map((file) => (
          <button
            key={file.path}
            type="button"
            onClick={() => onOpen(file)}
            title={`${file.name} · ${formatBytes(file.bytes)}`}
            className="flex flex-col gap-1.5 text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-offset-2"
          >
            <Thumb file={file} />
            <span className="truncate font-mono text-[11px] text-muted-foreground">
              {file.name}
            </span>
          </button>
        ))}
      </div>
      {data && data.total > files.length && (
        <p className="pt-4 font-mono text-[11px] text-muted-foreground/60">
          {`${files.length} of ${data.total.toLocaleString("en")} — the rest are in the folder`}
        </p>
      )}
    </div>
  );
}

/** A file shows itself where it can — a picture, a page, the head of a text — and its kind otherwise, so the grid stays one shape. */
function Thumb({ file }: { file: ArtifactFile }) {
  return (
    <FileThumb
      path={file.path}
      bytes={file.bytes}
      glyph="size-5"
      className="aspect-4/3 w-full rounded-xl ring-1 ring-foreground/5 ring-inset"
    />
  );
}

/**
 * The right pane before anything is picked: everything finished as its own face, under the
 * bot that made it — the shelf the menu beside it is the index of. A set shows as a folder.
 */
function Shelf({
  entries,
  bots,
  onPick,
}: {
  entries: Artifact[];
  bots?: Bot[];
  onPick: (row: Artifact) => void;
}) {
  return (
    <div className="space-y-7 p-6">
      {groupByBot(entries).map(({ bot, rows }) => (
        <section key={bot ?? ""} className="space-y-3">
          <h3 className="flex items-center gap-2 text-sm font-medium">
            {bot && (
              <BotMark
                size={20}
                seed={bot}
                {...markOf(bot, bots)}
                notify={false}
                className="shrink-0"
              />
            )}
            <span className="truncate">{bot ?? "Unsorted"}</span>
            <span className="font-mono text-[11px] font-normal text-muted-foreground">
              {rows.length}
            </span>
          </h3>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(9.5rem,1fr))] gap-x-4 gap-y-5">
            {rows.map((row) => (
              <button
                key={row.path}
                type="button"
                onClick={() => onPick(row)}
                className="group flex min-w-0 flex-col gap-1.5 rounded-xl text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                {row.kind === "set" ? (
                  <span className="grid aspect-4/3 w-full place-items-center rounded-xl bg-muted/60 text-muted-foreground transition-colors group-hover:bg-muted">
                    <FolderOpen className="size-5" />
                  </span>
                ) : (
                  <FileThumb
                    path={row.path}
                    bytes={row.bytes}
                    glyph="size-5"
                    className="aspect-4/3 w-full rounded-xl ring-1 ring-foreground/5 ring-inset"
                  />
                )}
                <span className="min-w-0 space-y-0.5 px-0.5">
                  <span className="block truncate text-[13px]">{row.name}</span>
                  <span className="block truncate font-mono text-[10.5px] text-muted-foreground">
                    {row.kind === "set"
                      ? `${row.count} ${row.count === 1 ? "file" : "files"} · `
                      : ""}
                    {shortAgo(row.at)}
                  </span>
                </span>
              </button>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

/** The right pane with nothing to show: what lands here, and where it comes from. Reveal folder is the footer's. */
function Nothing({ empty }: { empty: boolean }) {
  return (
    <div className="p-8">
      <p className="max-w-lg text-sm leading-relaxed text-muted-foreground">
        {empty
          ? "Nothing finished yet. When a bot ends a job with something to hand over — a page, a report, a set of pictures — it lands here."
          : "Pick something on the left. Each bot's work is under its face; a folder it filled is one row, and opens as a sheet."}
      </p>
    </div>
  );
}
