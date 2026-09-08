"use client";

import {
  ChevronLeft,
  ExternalLink,
  File,
  FileCode2,
  FileJson,
  FileText,
  FolderOpen,
  Image,
  Images,
  Music,
  Sheet,
  Trash2,
  Video,
} from "lucide-react";
import { useState } from "react";
import { queryKey } from "@/app/api/query-key";
import { Button } from "@/components/ui/button";
import { notify } from "@/components/ui/notify";
import { Skeleton } from "@/components/ui/skeleton";
import { ARTIFACT_VIEW, WORKSPACE_VIEW } from "@/config";
import { deleteArtifactAction } from "@/features/artifact/artifact.action";
import type {
  Artifact,
  ArtifactFile,
  ArtifactSet,
  ArtifactShelf,
} from "@/features/artifact/artifact.schema";
import {
  SettingError,
  SettingFilter,
  SettingPanes,
  SettingPanesSkeleton,
  SettingRailNote,
} from "@/features/settings/components/setting-ui";
import { FilePreview } from "@/features/workspace/components/file-view";
import type { FileViewKind } from "@/features/workspace/file-kind";
import { openFileAction } from "@/features/workspace/workspace.action";
import { shortAgo } from "@/lib/date-like";
import { useServerAction } from "@/lib/protocol/use-server-action";
import { revalidate, useServerRoute } from "@/lib/protocol/use-server-route";
import { cn, formatBytes } from "@/lib/utils";

/*
 * What the bots finished, listed the way they already file it: one entry at the
 * top of `artifacts/` is one artifact. A skill writes `artifacts/<name>.html`,
 * a job that makes a set writes `artifacts/<name>/`.
 *
 * So this is not Workspace pointed at one folder. There is no tree here: the
 * menu is flat and newest-first, and a folder does not open into another
 * listing — it opens as a sheet of what it holds, which is the thing a set of
 * pictures is for. Browsing a tree is Workspace's job.
 */

/** Every kind `viewKindOf` returns, plus the set. One icon table, as in Workspace. */
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

/** The row picked in the menu, and the file being read inside it. */
type Reading = { row: Artifact; file: ArtifactFile | null };

export function ArtifactSetting() {
  const [reading, setReading] = useState<Reading | null>(null);
  const [filter, setFilter] = useState("");
  const [rows, setRows] = useState(ARTIFACT_VIEW.rows);

  const { data, isLoading, error } = useServerRoute<ArtifactShelf>(
    queryKey.artifactShelf(rows),
    { keepPreviousData: true },
  );

  const [reveal] = useServerAction(openFileAction);

  if (isLoading) return <SettingPanesSkeleton />;
  if (error) return <SettingError message={error.message} />;

  const entries = data?.entries ?? [];
  const total = data?.total ?? 0;
  const needle = filter.trim().toLowerCase();
  const shown = needle
    ? entries.filter((entry) => entry.name.toLowerCase().includes(needle))
    : entries;

  // A fresh row when the open one is still listed, so a rewrite shows through
  const picked =
    entries.find((entry) => entry.path === reading?.row.path) ?? reading?.row;

  return (
    <SettingPanes
      footer={
        <>
          <SettingRailNote>
            <span className="font-mono">
              <span className="font-medium text-foreground">artifacts</span>
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
            placeholder="Filter artifacts"
            className="mx-2 mb-1.5 w-auto"
          />

          {shown.length === 0 ? (
            <p className="px-4 py-3 text-xs text-muted-foreground/60">
              {needle ? "Nothing matches" : "Nothing here yet"}
            </p>
          ) : (
            shown.map((entry) => (
              <MenuRow
                key={entry.path}
                entry={entry}
                active={entry.path === picked?.path}
                onPick={() => setReading({ row: entry, file: null })}
              />
            ))
          )}

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
          />
        ) : (
          <Nothing empty={total === 0} onReveal={() => reveal("artifacts")} />
        )
      }
    />
  );
}

/** `4 artifacts · 34 files`, and what is not on screen. Counts rows, so it is free. */
function countLine(shown: Artifact[], total: number, files: number): string {
  if (total === 0) return "empty";
  const head =
    total > shown.length
      ? `${shown.length} of ${total.toLocaleString("en")} artifacts`
      : `${total} ${total === 1 ? "artifact" : "artifacts"}`;
  return files > total ? `${head} · ${files.toLocaleString("en")} files` : head;
}

/** One row of the menu. A set says how many it holds; a file says what it weighs. */
function MenuRow({
  entry,
  active,
  onPick,
}: {
  entry: Artifact;
  active: boolean;
  onPick: () => void;
}) {
  const Icon = entry.kind === "set" ? Images : KIND_ICONS[entry.view];
  return (
    <button
      type="button"
      onClick={onPick}
      title={`${entry.name} · ${shortAgo(entry.at)}`}
      className={cn(
        "mx-2 flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] outline-none focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset",
        active
          ? "bg-secondary font-medium text-foreground"
          : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
      )}
    >
      <Icon className="size-3.5 shrink-0 opacity-70" />
      <span className="min-w-0 flex-1 truncate">{entry.name}</span>
      <span className="shrink-0 font-mono text-[11px] text-muted-foreground/75">
        {entry.kind === "set" ? entry.count : formatBytes(entry.bytes)}
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
}: {
  row: Artifact;
  /** The file being read inside a set; null reads the row itself. */
  file: ArtifactFile | null;
  onOpen: (file: ArtifactFile) => void;
  onBack: () => void;
  onGone: () => void;
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
      description: "It is deleted from disk for good.",
      okText: "Delete",
      destructive: true,
    });
    if (confirmed) remove(path);
  };

  return (
    <>
      <div className="flex h-11 shrink-0 items-center gap-3 border-b border-border/60 px-6">
        {file && (
          <button
            type="button"
            onClick={onBack}
            className="-ml-1 flex shrink-0 items-center gap-1 rounded-md px-1.5 py-1 font-mono text-[11px] text-muted-foreground outline-none hover:bg-muted/60 hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            <ChevronLeft className="size-3" />
            {row.name}
          </button>
        )}
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
        {open && (
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label="Delete"
            loading={removing}
            className="text-muted-foreground"
            onClick={() => confirmRemove(open.path)}
          >
            <Trash2 />
          </Button>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {open ? (
          <FilePreview path={open.path} bytes={open.bytes} />
        ) : (
          <SetSheet name={row.name} onOpen={onOpen} />
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
  name,
  onOpen,
}: {
  name: string;
  onOpen: (file: ArtifactFile) => void;
}) {
  const { data, isLoading, error } = useServerRoute<ArtifactSet>(
    queryKey.artifactSet(name, ARTIFACT_VIEW.setFiles),
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

/** A picture shows itself; anything else shows its kind, so the grid stays one shape. */
function Thumb({ file }: { file: ArtifactFile }) {
  // Past the cap it shows its kind instead: an `<img>` decodes whole, and a set is a grid of them
  if (file.view === "image" && file.bytes <= WORKSPACE_VIEW.elementMax) {
    return (
      // biome-ignore lint/performance/noImgElement: local raw route, nothing to optimize
      <img
        src={queryKey.file(file.path)}
        alt={file.name}
        loading="lazy"
        decoding="async"
        className="aspect-4/3 w-full rounded-xl object-cover"
      />
    );
  }
  const Icon = KIND_ICONS[file.view];
  return (
    <span className="grid aspect-4/3 w-full place-items-center rounded-xl bg-muted/40 text-muted-foreground">
      <Icon className="size-5" />
    </span>
  );
}

/** The right pane before anything is picked: what lands here, and where it comes from. */
function Nothing({
  empty,
  onReveal,
}: {
  empty: boolean;
  onReveal: () => void;
}) {
  return (
    <div className="space-y-4 p-8">
      <p className="max-w-lg text-sm leading-relaxed text-muted-foreground">
        {empty
          ? "Nothing finished yet. When a bot ends a job with something to hand over — a page, a report, a set of pictures — it lands here."
          : "Pick something on the left. A folder a bot filled is one row, and opens as a sheet."}
      </p>
      <Button variant="outline" onClick={onReveal}>
        <FolderOpen />
        Reveal folder
      </Button>
    </div>
  );
}
