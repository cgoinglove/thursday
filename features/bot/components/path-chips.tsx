"use client";

import {
  File,
  FileCode,
  FileImage,
  FileJson,
  FileSpreadsheet,
  FileText,
  FileType,
  FileX,
  type LucideIcon,
} from "lucide-react";
import { useMemo } from "react";
import { queryKey } from "@/app/api/query-key";
import { FileLink } from "@/features/workspace/components/file-view";
import { pathsIn, viewKindOf } from "@/features/workspace/file-kind";
import { useServerRoute } from "@/lib/protocol/use-server-route";
import { cn } from "@/lib/utils";

/** The glyph names the file, not what opening it does: a chip you can read at a glance. */
const ICONS: Record<string, LucideIcon> = {
  markdown: FileText,
  csv: FileSpreadsheet,
  json: FileJson,
  text: FileType,
  image: FileImage,
};

function iconFor(path: string): LucideIcon {
  const kind = viewKindOf(path);
  // `frame` is two very different things; the extension is what the reader recognises.
  if (kind === "frame") {
    return path.toLowerCase().endsWith(".pdf") ? FileText : FileCode;
  }
  return ICONS[kind] ?? File;
}

/**
 * File paths mentioned in an answer, as chips. Derived from the text, never stored;
 * where a file opens is fileTarget's call. A path with no file on disk — never
 * written, or gone since — stays in place, struck through and not a link.
 */
export function PathChips({
  text,
  className,
}: {
  text: string;
  className?: string;
}) {
  const paths = useMemo(() => pathsIn(text), [text]);
  const { data: missing } = useServerRoute<string[]>(
    paths.length ? queryKey.workspaceMissing(paths) : null,
  );
  const gone = useMemo(() => new Set(missing), [missing]);
  if (!paths.length) return null;

  const chip =
    "flex max-w-full items-center gap-1.5 rounded-full bg-muted/70 py-1 pr-2.5 pl-2 font-mono text-[11px]";

  return (
    <div className={cn("flex flex-wrap gap-1.5", className)}>
      {paths.map((path) => {
        const name = path.split("/").pop() ?? path;
        if (gone.has(path)) {
          return (
            <span
              key={path}
              title={`${path} — not on disk`}
              className={cn(chip, "text-muted-foreground")}
            >
              <FileX className="size-3 shrink-0" />
              <span className="truncate line-through">{name}</span>
            </span>
          );
        }
        const Icon = iconFor(path);
        return (
          <FileLink
            key={path}
            path={path}
            className={cn(
              chip,
              "text-foreground/80 outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50",
            )}
          >
            <Icon className="size-3 shrink-0 text-muted-foreground" />
            <span className="truncate">{name}</span>
          </FileLink>
        );
      })}
    </div>
  );
}
