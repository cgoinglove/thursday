"use client";

import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { queryKey } from "@/app/api/query-key";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Markdown } from "@/components/ui/markdown";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { WORKSPACE_VIEW } from "@/config";
import {
  type FileViewKind,
  viewKindOf,
  workspaceRelative,
} from "@/features/workspace/file-kind";
import { openFileAction } from "@/features/workspace/workspace.action";
import { useServerAction } from "@/lib/protocol/use-server-action";
import { cn, errorToString, formatBytes } from "@/lib/utils";

/**
 * Renders workspace files; shared by the viewer page (/artifact) and the
 * path-chip dialog. The file decides how it opens: kinds the browser draws or
 * plays itself (html, pdf, image, audio, video) in a new tab, readable text in
 * a dialog, everything else (and anything outside the workspace) in the OS
 * default app.
 */

/** Kinds the browser renders on its own; they open as a page, never as text. */
const OWN_PAGE = new Set<FileViewKind>(["frame", "image", "audio", "video"]);

export type FileTarget =
  | { how: "tab"; path: string; href: string }
  | { how: "dialog"; path: string }
  | { how: "os" };

export function fileTarget(raw: string): FileTarget {
  const path = workspaceRelative(raw);
  if (!path) return { how: "os" };
  const kind = viewKindOf(path);
  if (OWN_PAGE.has(kind)) {
    return { how: "tab", path, href: queryKey.fileView(path) };
  }
  return kind === "none" ? { how: "os" } : { how: "dialog", path };
}

const OpenInDialog = createContext<((path: string) => void) | null>(null);

/**
 * Opens a file from code (artifact-view), same policy as `FileLink`. Returns
 * whether it opened: a new tab without a user gesture may be blocked.
 */
export function useOpenFile() {
  const inDialog = useContext(OpenInDialog);
  return useCallback(
    (raw: string): boolean => {
      const target = fileTarget(raw);
      if (target.how === "os") return false;
      if (target.how === "dialog" && inDialog) {
        inDialog(target.path);
        return true;
      }
      const href =
        target.how === "tab" ? target.href : queryKey.fileView(target.path);
      return window.open(href, "_blank") !== null;
    },
    [inDialog],
  );
}

/** One dialog shared by every link beneath it. */
export function FileViewer({ children }: { children: ReactNode }) {
  const [path, setPath] = useState<string | null>(null);
  return (
    <OpenInDialog value={setPath}>
      {children}
      <FileDialog
        path={path}
        kind={path ? viewKindOf(path) : "text"}
        onClose={() => setPath(null)}
      />
    </OpenInDialog>
  );
}

/** A link to one file; `fileTarget` decides where. A new tab is a real `<a>` so middle-click works. */
export function FileLink({
  path,
  className,
  title,
  label,
  children,
}: {
  /** The path as the bot gave it, relative or absolute. */
  path: string;
  className?: string;
  title?: string;
  /** Accessible name for icon-only links. */
  label?: string;
  children: ReactNode;
}) {
  const target = fileTarget(path);
  const inDialog = useContext(OpenInDialog);
  const [openWithOs, opening] = useServerAction(openFileAction);

  if (target.how === "tab") {
    return (
      <a
        href={target.href}
        target="_blank"
        rel="noreferrer"
        title={title ?? path}
        aria-label={label}
        className={className}
      >
        {children}
      </a>
    );
  }

  return (
    <button
      type="button"
      disabled={opening}
      title={title ?? path}
      aria-label={label}
      className={className}
      onClick={() => {
        // Outside a FileViewer there is no dialog, so open a tab
        if (target.how === "dialog") {
          if (inDialog) inDialog(target.path);
          else window.open(queryKey.fileView(target.path), "_blank");
          return;
        }
        void openWithOs(path);
      }}
    >
      {children}
    </button>
  );
}

/** Padding per place; tables and code get less because they want width. */
const PAD: Record<FileViewPlace, { prose: string; block: string }> = {
  dialog: { prose: "px-5 py-4", block: "px-4 py-3" },
  page: { prose: "px-5 py-6 sm:px-8", block: "px-5 py-5" },
};

/** Where the file is read: inside the dialog or on its own page. */
export type FileViewPlace = "dialog" | "page";

export function FileBody({
  kind,
  content,
  truncated,
  where = "dialog",
}: {
  kind: FileViewKind;
  content: string;
  /** The file's size on disk when only its head is here; null when whole. */
  truncated?: number | null;
  where?: FileViewPlace;
}) {
  return (
    <>
      {truncated != null && <Truncated of={truncated} />}
      <Body kind={kind} content={content} where={where} />
    </>
  );
}

/** Says the text is a head, not the file — a cut CSV row or JSON tail reads as corrupt otherwise. */
function Truncated({ of }: { of: number }) {
  return (
    <p className="border-b border-border/60 px-5 py-2.5 font-mono text-[11px] text-muted-foreground">
      {`Showing the first ${formatBytes(WORKSPACE_VIEW.textMax)} of ${formatBytes(of)}. `}
      Open the file itself for the rest.
    </p>
  );
}

function Body({
  kind,
  content,
  where,
}: {
  kind: FileViewKind;
  content: string;
  where: FileViewPlace;
}) {
  const pad = PAD[where];
  switch (kind) {
    case "markdown":
      // min-w-0: wide tables and long code lines scroll inside their box, not push the layout
      return (
        <div className={cn("min-w-0 text-sm leading-relaxed", pad.prose)}>
          <Markdown>{content}</Markdown>
        </div>
      );
    case "csv":
      return <CsvTable content={content} className={pad.block} />;
    case "json":
      return <Plain text={prettyJson(content)} className={pad.block} />;
    default:
      return <Plain text={content} className={pad.block} />;
  }
}

/**
 * A workspace file's head. The raw route carries no Result envelope, so this
 * fetches rather than going through the SWR hook.
 *
 * The request is a Range, never the whole file: a bot writes logs and dumps
 * that no `<pre>` survives, and the size is not known before asking. What came
 * back short is reported as `truncated`, so the view can say so.
 */
export function useFileText(path: string | null) {
  const [content, setContent] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  /** The file's size on disk when only its head arrived; null when whole. */
  const [truncated, setTruncated] = useState<number | null>(null);

  useEffect(() => {
    if (!path) return;
    setContent(null);
    setFailure(null);
    setTruncated(null);
    let gone = false;
    fetch(queryKey.file(path), {
      headers: { range: `bytes=0-${WORKSPACE_VIEW.textMax - 1}` },
    })
      .then(async (res) => {
        if (!res.ok) throw new Error(await res.text());
        return { text: await res.text(), of: shortOf(res) };
      })
      .then(({ text, of }) => {
        if (gone) return;
        // Drop the last, partial line so a cut never reads as the file's own
        const cut =
          of === null
            ? text
            : text.slice(0, text.lastIndexOf("\n") + 1 || undefined);
        setContent(cut);
        setTruncated(of);
      })
      .catch((cause) => !gone && setFailure(errorToString(cause)));
    return () => {
      gone = true;
    };
  }, [path]);

  return { content, failure, truncated };
}

/**
 * The file's full size when the response is only part of it, else null. A file
 * under the cap answers 206 too, so the range's end is what decides.
 */
function shortOf(res: Response): number | null {
  const parts = res.headers
    .get("content-range")
    ?.match(/^bytes \d+-(\d+)\/(\d+)$/);
  if (!parts) return null;
  const [, end, size] = parts.map(Number);
  return end + 1 < size ? size : null;
}

/**
 * One file drawn where it sits (the Workspace section). Kinds the browser fills
 * itself are elements; text kinds fetch and go through `FileBody`.
 */
export function FilePreview({ path, bytes }: { path: string; bytes: number }) {
  const kind = viewKindOf(path);
  // Only text kinds are fetched; the rest are elements the browser fills itself.
  const { content, failure, truncated } = useFileText(
    OWN_PAGE.has(kind) ? null : path,
  );

  // An `<img>` decodes whole and a huge page cannot be scrolled, and neither
  // says so — it just stops. Audio and video are absent: those stream.
  if (
    (kind === "frame" || kind === "image") &&
    bytes > WORKSPACE_VIEW.elementMax
  ) {
    return <TooBig path={path} bytes={bytes} />;
  }

  if (kind === "frame") {
    // No sandbox: the html is local and just written by a bot; sandboxing only
    // breaks its forms, fonts and scripts (same call as /artifact).
    return (
      <iframe
        title={path}
        src={queryKey.file(path)}
        allow="clipboard-read; clipboard-write; fullscreen; autoplay"
        className="h-full w-full bg-white"
      />
    );
  }
  if (kind === "image") {
    return (
      // biome-ignore lint/performance/noImgElement: local raw route, nothing to optimize
      <img
        src={queryKey.file(path)}
        alt={path}
        className="mx-auto max-w-full p-6"
      />
    );
  }
  if (kind === "audio" || kind === "video") {
    return kind === "audio" ? (
      <audio controls src={queryKey.file(path)} className="w-full p-6">
        <track kind="captions" />
      </audio>
    ) : (
      <video controls src={queryKey.file(path)} className="max-w-full p-6">
        <track kind="captions" />
      </video>
    );
  }
  if (failure) {
    return <p className="p-5 font-mono text-xs text-destructive">{failure}</p>;
  }
  if (content === null) {
    return (
      <div className="space-y-3 p-5">
        <Skeleton className="h-5 w-2/3" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-5/6" />
      </div>
    );
  }
  return <FileBody kind={kind} content={content} truncated={truncated} />;
}

/** Past `elementMax`: the preview says what it is instead of taking the tab down with it. */
function TooBig({ path, bytes }: { path: string; bytes: number }) {
  const [reveal, revealing] = useServerAction(openFileAction);
  return (
    <div className="space-y-4 p-8">
      <p className="max-w-lg text-sm leading-relaxed text-muted-foreground">
        {`This file is ${formatBytes(bytes)} — too big to draw here without `}
        taking the window with it. Open it where it is instead.
      </p>
      <Button
        variant="outline"
        loading={revealing}
        onClick={() => reveal(path)}
      >
        Reveal in the file manager
      </Button>
    </div>
  );
}

/** A text file in a dialog, fetched from the raw route when opened. */
export function FileDialog({
  path,
  kind,
  onClose,
}: {
  /** Workspace-relative path; null means closed. */
  path: string | null;
  kind: FileViewKind;
  onClose: () => void;
}) {
  const { content, failure, truncated } = useFileText(path);
  const name = path?.split("/").pop() ?? "";

  return (
    <Dialog open={path !== null} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="flex max-h-[calc(100vh-3rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-4xl">
        <DialogTitle className="sr-only">{name}</DialogTitle>

        <div className="flex shrink-0 items-center gap-2 border-b border-border/60 px-4 py-2.5 pr-12">
          <span className="min-w-0 flex-1 truncate font-mono text-[12px]">
            {path}
          </span>
        </div>

        <div className="min-h-0 flex-1 overflow-auto">
          {failure ? (
            <p className="p-5 font-mono text-xs text-destructive">{failure}</p>
          ) : content === null ? (
            <div className="space-y-3 p-5">
              <Skeleton className="h-5 w-2/3" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-5/6" />
            </div>
          ) : (
            <FileBody kind={kind} content={content} truncated={truncated} />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Plain({ text, className }: { text: string; className?: string }) {
  return (
    <pre
      className={cn(
        "overflow-x-auto font-mono text-[12px] leading-relaxed whitespace-pre-wrap text-foreground/90",
        className,
      )}
    >
      {text}
    </pre>
  );
}

function prettyJson(content: string) {
  try {
    return JSON.stringify(JSON.parse(content), null, 2);
  } catch {
    return content;
  }
}

/** First row is the header. Quoting per RFC 4180. */
function CsvTable({
  content,
  className,
}: {
  content: string;
  className?: string;
}) {
  const rows = useMemo(() => parseCsv(content), [content]);
  const [head, ...body] = rows;
  if (!head) return <Plain text={content} className={className} />;

  return (
    <div className={cn("overflow-x-auto", className)}>
      <Table>
        <TableHeader>
          <TableRow>
            {head.map((cell, at) => (
              <TableHead key={`${at}-${cell}`} className="whitespace-nowrap">
                {cell}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {body.map((row, r) => (
            <TableRow key={`${r}-${row[0] ?? ""}`}>
              {head.map((_, c) => (
                <TableCell key={`${r}-${c}`} className="whitespace-nowrap">
                  {row[c] ?? ""}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') {
        quoted = false;
      } else {
        cell += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += ch;
    }
  }
  if (cell.length || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((entry) => entry.some((value) => value.trim()));
}
