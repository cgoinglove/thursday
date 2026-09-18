"use client";

import {
  File,
  FileCode,
  FileImage,
  FileJson,
  FileSpreadsheet,
  FileText,
  FileType,
  FileVideo,
  FileX,
  type LucideIcon,
  Music,
} from "lucide-react";
import { useMemo } from "react";
import { queryKey } from "@/app/api/query-key";
import { FileLink } from "@/features/workspace/components/file-view";
import { pathsIn, viewKindOf } from "@/features/workspace/file-kind";
import type { FileOnDisk } from "@/features/workspace/workspace.schema";
import { useServerRoute } from "@/lib/protocol/use-server-route";
import { cn, formatBytes } from "@/lib/utils";

/** The glyph names the file, not what opening it does: a tile you can read at a glance. */
const ICONS: Record<string, LucideIcon> = {
  markdown: FileText,
  csv: FileSpreadsheet,
  json: FileJson,
  text: FileType,
  image: FileImage,
  audio: Music,
  video: FileVideo,
};

function iconFor(path: string): LucideIcon {
  const kind = viewKindOf(path);
  // `frame` is two very different things; the extension is what the reader recognises.
  if (kind === "frame") {
    return path.toLowerCase().endsWith(".pdf") ? FileText : FileCode;
  }
  return ICONS[kind] ?? File;
}

/** What the meta line says a file is, since the name may not: the extension, lower case. */
const kindOf = (path: string) => path.split(".").pop()?.toLowerCase() ?? "file";

const nameOf = (path: string) => path.split("/").pop() ?? path;

/** Images shown before the last tile counts the rest. Four fills the column; a fifth would shrink them all. */
const TILES = 4;

/**
 * The files a message names, drawn as what they are: images as thumbnails that
 * open in the viewer, everything else as a row with its kind and size. Derived
 * from the text, never stored; where a file opens is fileTarget's call. A path
 * with no file on disk — never written, or gone since — stays in place, struck
 * through and not a link.
 */
export function Attachments({
  text,
  className,
  onBubble = false,
}: {
  text: string;
  className?: string;
  /** Inside a message bubble, where the page's own background stands off the surface. */
  onBubble?: boolean;
}) {
  const paths = useMemo(() => pathsIn(text), [text]);
  const { data: found } = useServerRoute<FileOnDisk[]>(
    paths.length ? queryKey.workspaceFiles(paths) : null,
  );
  const files = useMemo(() => found ?? [], [found]);
  const images = useMemo(
    () => files.filter((file) => viewKindOf(file.path) === "image"),
    [files],
  );
  const rest = files.filter((file) => viewKindOf(file.path) !== "image");
  // A report often names the same file twice, once by a path that never existed.
  // Only what is nowhere on the list is struck through; the file is already there.
  const names = new Set(files.map((file) => nameOf(file.path)));
  const gone = paths.filter(
    (path) =>
      !files.some((file) => file.path === path) && !names.has(nameOf(path)),
  );
  if (!paths.length || !found) return null;
  if (!files.length && !gone.length) return null;

  const group = images.map((file) => file.path);
  const shown = images.slice(0, TILES);
  const over = images.length - shown.length;
  // One or two images have the room to be looked at; more become a row of tiles.
  const wide = images.length <= 2;

  return (
    <div className={cn("flex min-w-0 flex-col gap-1.5", className)}>
      {shown.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {shown.map((file, at) => (
            <FileLink
              key={file.path}
              path={file.path}
              group={group}
              title={`${file.path} — ${formatBytes(file.bytes)}`}
              className={cn(
                "relative shrink-0 overflow-hidden rounded-xl bg-muted outline-none ring-1 ring-foreground/5 ring-inset transition-opacity hover:opacity-90 focus-visible:ring-3 focus-visible:ring-ring/50",
                wide ? "h-40 w-32" : "h-26.25 w-21",
              )}
            >
              {/* biome-ignore lint/performance/noImgElement: local raw route, nothing to optimize */}
              <img
                src={queryKey.file(file.path)}
                alt={nameOf(file.path)}
                loading="lazy"
                decoding="async"
                className="size-full object-cover"
              />
              {over > 0 && at === shown.length - 1 && (
                <span className="absolute inset-0 grid place-items-center bg-black/45 text-[14px] font-medium text-white">
                  +{over}
                </span>
              )}
            </FileLink>
          ))}
        </div>
      )}

      {rest.map((file) => {
        const Icon = iconFor(file.path);
        return (
          <FileLink
            key={file.path}
            path={file.path}
            title={file.path}
            className={cn(
              "flex w-fit max-w-full items-center gap-2.5 rounded-xl py-1.5 pr-3 pl-1.5 outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50",
              onBubble
                ? "bg-background/70 hover:bg-background"
                : "bg-muted/70 hover:bg-muted",
            )}
          >
            <span
              className={cn(
                "grid size-8 shrink-0 place-items-center rounded-lg text-muted-foreground",
                onBubble ? "bg-muted" : "bg-background",
              )}
            >
              <Icon className="size-3.5" />
            </span>
            <span className="flex min-w-0 flex-col items-start">
              <span className="max-w-full truncate text-[12.5px] leading-4.25">
                {nameOf(file.path)}
              </span>
              <span className="font-mono text-[10px] leading-3.5 text-muted-foreground">
                {kindOf(file.path)} · {formatBytes(file.bytes)}
              </span>
            </span>
          </FileLink>
        );
      })}

      {gone.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {gone.map((path) => (
            <span
              key={path}
              title={`${path} — not on disk`}
              className="flex max-w-full items-center gap-1.5 rounded-full bg-muted/70 py-1 pr-2.5 pl-2 font-mono text-[11px] text-muted-foreground"
            >
              <FileX className="size-3 shrink-0" />
              <span className="truncate line-through">{nameOf(path)}</span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

/** The images a message names, for anything that wants their thumbnails without the rows. */
export function imagePathsIn(text: string): string[] {
  return pathsIn(text).filter((path) => viewKindOf(path) === "image");
}

/**
 * The same words with the paths they name cut to file names, since the files
 * themselves are drawn under them. Only inline code outside fenced blocks: a
 * command in a block is the path it needs.
 */
export function shortenPaths(text: string): string {
  return text
    .split(/(```[\s\S]*?```)/)
    .map((part, at) =>
      at % 2 === 1
        ? part
        : part.replace(/`([^`\n]+)`/g, (whole, inner: string) => {
            const one = inner.trim();
            if (!one.includes("/")) return whole;
            const [path] = pathsIn(one);
            const name = path?.split("/").pop();
            return path && name && one.endsWith(name) ? `\`${name}\`` : whole;
          }),
    )
    .join("");
}
