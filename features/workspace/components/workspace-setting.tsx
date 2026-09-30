"use client";

import {
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  File,
  FileCode2,
  FileJson,
  FileText,
  Folder,
  FolderOpen,
  Image,
  Music,
  Sheet,
  Trash2,
  Video,
} from "lucide-react";
import { type ReactNode, useState } from "react";
import { queryKey } from "@/app/api/query-key";
import { Button } from "@/components/ui/button";
import { notify } from "@/components/ui/notify";
import { PATHS, WORKSPACE_VIEW } from "@/config";
import {
  PICKED_ROW,
  SettingError,
  SettingFilter,
  SettingPanes,
  SettingPanesSkeleton,
  SettingRailNote,
} from "@/features/settings/components/setting-ui";
import { FilePreview } from "@/features/workspace/components/file-view";
import type { FileViewKind } from "@/features/workspace/file-kind";
import {
  deleteWorkspaceFileAction,
  emptyScratchAction,
  revealFileAction,
} from "@/features/workspace/workspace.action";
import type {
  WorkspaceEntry,
  WorkspaceFile,
  WorkspaceFolder,
} from "@/features/workspace/workspace.schema";
import { useLocale } from "@/hooks/use-locale";
import { shortAgo } from "@/lib/date-like";
import type { Locale } from "@/lib/locale";
import { useServerAction } from "@/lib/protocol/use-server-action";
import { revalidate, useServerRoute } from "@/lib/protocol/use-server-route";
import { cn, formatBytes } from "@/lib/utils";
import { settingsDictOf, type WorkspaceDict } from "@/messages";

/*
 * What the bots wrote, browsed the way the skill browser browses a skill: one
 * folder at a time, a back row up, the picked file drawn on the right.
 *
 * The section shows work, not machinery: only files the app can open, and only
 * folders `isListedFolder` keeps — a bot also writes node_modules, browser
 * snapshots and spilled tool output. No row carries a folder's size, because
 * a folder's size is every file under it and this screen opens on a click.
 */

/** A row's glyph for every kind `viewKindOf` returns. */
const KIND_ICONS: Record<FileViewKind, typeof File> = {
  markdown: FileText,
  csv: Sheet,
  json: FileJson,
  text: FileText,
  frame: FileCode2,
  image: Image,
  audio: Music,
  video: Video,
  none: File,
};

export function WorkspaceSetting() {
  /** Workspace-relative folder being listed; "" is the root. */
  const [dir, setDir] = useState("");
  /** Rows asked for. A bot's folder can hold thousands; Show more raises it. */
  const [rows, setRows] = useState(WORKSPACE_VIEW.rows);
  /** The open file. It survives browsing, the way the skill browser's does. */
  const [file, setFile] = useState<WorkspaceFile | null>(null);
  const [filter, setFilter] = useState("");

  const { data, isLoading, error } = useServerRoute<WorkspaceFolder>(
    queryKey.workspaceFolder(dir, rows),
    // Entering a folder and asking for more rows both change the key. Without
    // this the panes fall back to the skeleton every time, which unmounts the
    // open file and re-reads it; the skeleton is for the first read only.
    { keepPreviousData: true },
  );

  /** A folder is entered at the first page, never at the last one's depth. */
  const enter = (path: string) => {
    setDir(path);
    setRows(WORKSPACE_VIEW.rows);
  };

  const locale = useLocale();
  const t = settingsDictOf(locale).workspace;

  const [emptyScratch, emptying] = useServerAction(emptyScratchAction, {
    okMessage: t.scratchDone,
    onOk: () => revalidate(queryKey.workspace),
  });

  const [reveal] = useServerAction(revealFileAction);

  const confirmEmptyScratch = async () => {
    const confirmed = await notify.confirm({
      title: t.emptyScratchTitle,
      description: t.emptyScratchBody(
        PATHS.scratch,
        PATHS.artifacts,
        PATHS.projects,
      ),
      okText: t.emptyScratchOk,
      destructive: true,
    });
    if (confirmed) emptyScratch();
  };

  if (isLoading) return <SettingPanesSkeleton />;
  if (error) return <SettingError message={error.message} />;

  const entries = data?.entries ?? [];
  const total = data?.total ?? 0;
  const needle = filter.trim().toLowerCase();
  const shown = needle
    ? entries.filter((entry) => entry.name.toLowerCase().includes(needle))
    : entries;
  const folders = shown.filter((entry) => entry.kind === "dir");
  const files = shown.filter((entry) => entry.kind === "file");
  /**
   * Emptying scratch is offered unless the root proves there is nothing to empty —
   * a workspace no job has used yet has no `scratch/`. Deeper in the tree the root's
   * rows are not in hand, so the button stays.
   */
  const hasScratch =
    dir !== "" ||
    entries.some(
      (entry) => entry.kind === "dir" && entry.name === PATHS.scratch,
    );
  // A fresh row when the open file is in the folder on screen, so size and age
  // follow a rewrite; the last known row otherwise.
  const open =
    entries.find(
      (entry) => entry.kind === "file" && entry.path === file?.path,
    ) ?? file;

  return (
    <SettingPanes
      footer={
        <>
          <SettingRailNote>
            {/* This folder, not the tree: the section never reads below the row it draws. */}
            <span className="font-mono">
              <span className="font-medium text-foreground">
                {`${PATHS.workspace}${dir ? `/${dir}` : ""}`}
              </span>
              {` · ${countLine(entries, total, t)}`}
            </span>
          </SettingRailNote>
          <Button
            variant="outline"
            size="sm"
            onClick={() => reveal(dir || ".")}
          >
            <FolderOpen />
            {t.revealFolder}
          </Button>
          {hasScratch && (
            <Button
              variant="outline"
              size="sm"
              loading={emptying}
              onClick={confirmEmptyScratch}
              className="text-destructive hover:text-destructive"
            >
              {t.emptyScratchBtn}
            </Button>
          )}
        </>
      }
      left={
        <div className="flex flex-col py-2">
          <SettingFilter
            value={filter}
            onChange={setFilter}
            placeholder={t.filter}
            className="mx-2 mb-1.5 w-auto"
          />

          {dir && (
            <button
              type="button"
              onClick={() => enter(dir.split("/").slice(0, -1).join("/"))}
              className="mx-2 mb-1 flex items-center gap-1 rounded-md px-2 py-1 text-left font-mono text-[11px] text-muted-foreground outline-none hover:bg-muted/60 hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset"
            >
              <ChevronLeft className="size-3 shrink-0" />
              <span className="truncate">
                {dir.split("/").slice(0, -1).pop() ?? "workspace"}
              </span>
            </button>
          )}

          {shown.length === 0 ? (
            <p className="px-4 py-3 text-xs text-muted-foreground/60">
              {needle ? t.nothingMatches : t.emptyFolder}
            </p>
          ) : (
            <>
              <Group label={t.foldersWord} rows={folders}>
                {folders.map((entry) => (
                  <EntryRow
                    key={entry.path}
                    entry={entry}
                    onPick={() => enter(entry.path)}
                  />
                ))}
              </Group>
              <Group label={t.filesWord} rows={files}>
                {files.map((entry) => (
                  <EntryRow
                    key={entry.path}
                    entry={entry}
                    active={entry.path === file?.path}
                    onPick={() => entry.kind === "file" && setFile(entry)}
                  />
                ))}
              </Group>
            </>
          )}

          {total > entries.length && (
            <button
              type="button"
              onClick={() => setRows(rows + WORKSPACE_VIEW.rows)}
              className="mx-2 mt-2 rounded-md px-2 py-1.5 text-left font-mono text-[11px] text-muted-foreground outline-none hover:bg-muted/60 hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset"
            >
              {/* The filter only sees loaded rows, so the count says what it is not searching */}
              {t.showMore(
                Math.min(WORKSPACE_VIEW.rows, total - entries.length),
                total.toLocaleString("en"),
              )}
            </button>
          )}
        </div>
      }
      right={
        open?.kind === "file" ? (
          // Keyed so one file's scroll and fetch never carry into the next
          <FilePage key={open.path} file={open} onGone={() => setFile(null)} />
        ) : (
          <Nothing empty={!dir && entries.length === 0} />
        )
      }
    />
  );
}

/** What the folder holds, for the rail. Counts rows, so it costs nothing to say. */
function countLine(
  entries: WorkspaceEntry[],
  total: number,
  t: WorkspaceDict,
): string {
  const folders = entries.filter((entry) => entry.kind === "dir").length;
  const files = entries.length - folders;
  const parts = [
    folders && `${folders} ${folders === 1 ? t.folderOne : t.folderMany}`,
    files && `${files} ${files === 1 ? t.fileOne : t.fileMany}`,
  ].filter(Boolean);
  if (!parts.length) return t.countEmpty;
  const line = parts.join(" · ");
  return total > entries.length
    ? `${line}${t.countOf(total.toLocaleString("en"))}`
    : line;
}

/** A labelled run of rows; drawn only when it has any, so a folder of files has no empty heading. */
function Group({
  label,
  rows,
  children,
}: {
  label: string;
  rows: WorkspaceEntry[];
  children: ReactNode;
}) {
  if (rows.length === 0) return null;
  return (
    <>
      <span className="px-3 pt-3 pb-1 font-mono text-[10px] text-muted-foreground/60">
        {label}
      </span>
      {children}
    </>
  );
}

function EntryRow({
  entry,
  active,
  onPick,
}: {
  entry: WorkspaceEntry;
  active?: boolean;
  onPick: () => void;
}) {
  const locale = useLocale();
  const Icon = entry.kind === "dir" ? Folder : KIND_ICONS[entry.view];
  return (
    <button
      type="button"
      onClick={onPick}
      title={
        entry.kind === "file"
          ? `${entry.name} · ${shortAgo(entry.at, Date.now(), locale)}`
          : entry.name
      }
      className={cn(
        "mx-2 flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] outline-none focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset",
        active
          ? cn(PICKED_ROW, "font-medium")
          : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
      )}
    >
      <Icon className="size-3.5 shrink-0 opacity-70" />
      <span className="min-w-0 flex-1 truncate">{entry.name}</span>
      {entry.kind === "file" ? (
        <>
          <span className="shrink-0 font-mono text-[11px] text-muted-foreground/75">
            {formatBytes(entry.bytes)}
          </span>
          <span className="w-3.5 shrink-0" />
        </>
      ) : (
        // A folder says no size: reading one means walking everything under it
        <ChevronRight className="size-3.5 shrink-0 text-muted-foreground/50" />
      )}
    </button>
  );
}

/** The right pane before anything is picked: what this section lists, and why not more. Reveal folder is the footer's. */
function Nothing({
  empty,
}: {
  /** Nothing anywhere in the workspace can be opened yet. */
  empty: boolean;
}) {
  const t = settingsDictOf(useLocale()).workspace;
  return (
    <div className="space-y-4 p-8">
      {empty ? (
        <p className="max-w-lg text-sm leading-relaxed text-muted-foreground">
          {t.nothingEmptyHead}{" "}
          <span className="font-mono text-[13px] text-foreground">
            {PATHS.artifacts}/
          </span>{" "}
          {t.nothingEmptyTail}
        </p>
      ) : (
        <>
          <p className="text-sm leading-relaxed text-muted-foreground">
            {t.pickFile}
          </p>
          <p className="max-w-lg text-sm leading-relaxed text-muted-foreground">
            {t.nothingListed}
          </p>
        </>
      )}
    </div>
  );
}

/** One file: where it is, what it costs, what can be done to it, and the file itself. */
function FilePage({
  file,
  onGone,
}: {
  file: WorkspaceFile;
  onGone: () => void;
}) {
  const path = file.path;
  const [reveal] = useServerAction(revealFileAction);
  const locale = useLocale();
  const t = settingsDictOf(locale).workspace;
  const [remove, removing] = useServerAction(deleteWorkspaceFileAction, {
    okMessage: t.fileDeletedOk,
    onOk: () => {
      revalidate(queryKey.workspace);
      onGone();
    },
  });

  const confirmRemove = async () => {
    const confirmed = await notify.confirm({
      title: t.deleteTitle(path.split("/").pop() ?? path),
      description: t.deleteBody,
      okText: t.deleteOk,
      destructive: true,
    });
    if (confirmed) remove(path);
  };

  return (
    <>
      <div className="flex shrink-0 items-center gap-3 border-b border-border/60 px-6 py-2">
        <Crumbs path={path} />
        <span className="shrink-0 font-mono text-[11px] text-muted-foreground/70">
          {formatBytes(file.bytes)} · {shortAgo(file.at, Date.now(), locale)}
        </span>
        <a
          href={queryKey.fileView(path)}
          target="_blank"
          rel="noreferrer"
          aria-label={t.openNewTab}
          className="grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground outline-none transition-colors hover:bg-muted/60 hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <ExternalLink className="size-4" />
        </a>
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label={t.revealManager}
          className="text-muted-foreground"
          onClick={() => reveal(path)}
        >
          <FolderOpen />
        </Button>
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label={t.deleteAria}
          loading={removing}
          className="text-muted-foreground"
          onClick={confirmRemove}
        >
          <Trash2 />
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        <FilePreview path={path} bytes={file.bytes} />
      </div>
    </>
  );
}

/** Where the file is, as the skill browser draws it: segments, chevrons, the last one lit. */
function Crumbs({ path }: { path: string }) {
  const parts = ["workspace", ...path.split("/").filter(Boolean)];
  return (
    <span className="flex min-w-0 flex-1 items-center gap-1 font-mono text-[11px] text-muted-foreground">
      {parts.map((part, at) => (
        <span key={`${at}-${part}`} className="flex min-w-0 items-center gap-1">
          {at > 0 && <ChevronRight className="size-3 shrink-0 opacity-50" />}
          <span
            className={cn(
              "truncate",
              at === parts.length - 1 && "text-foreground",
            )}
          >
            {part}
          </span>
        </span>
      ))}
    </span>
  );
}
