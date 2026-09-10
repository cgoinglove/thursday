"use client";

import {
  File,
  FileCode,
  FileImage,
  FileJson,
  FileSpreadsheet,
  FileText,
  FileType,
  type LucideIcon,
} from "lucide-react";
import { useMemo } from "react";
import { FileLink } from "@/features/workspace/components/file-view";
import { pathsIn, viewKindOf } from "@/features/workspace/file-kind";
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

/** File paths mentioned in an answer, as chips. Derived from the text, never stored; where a file opens is fileTarget's call. */
export function PathChips({
  text,
  className,
}: {
  text: string;
  className?: string;
}) {
  const paths = useMemo(() => pathsIn(text), [text]);
  if (!paths.length) return null;

  const chip =
    "flex max-w-full items-center gap-1.5 rounded-full bg-muted/70 py-1 pr-2.5 pl-2 font-mono text-[11px] text-foreground/80 outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50";

  return (
    <div className={cn("flex flex-wrap gap-1.5", className)}>
      {paths.map((path) => {
        const name = path.split("/").pop() ?? path;
        const Icon = iconFor(path);
        return (
          <FileLink key={path} path={path} className={chip}>
            <Icon className="size-3 shrink-0 text-muted-foreground" />
            <span className="truncate">{name}</span>
          </FileLink>
        );
      })}
    </div>
  );
}
