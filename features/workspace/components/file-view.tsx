"use client";

import { ChevronLeft, ChevronRight, ExternalLink } from "lucide-react";
import Image from "next/image";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
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
import {
  openFileAction,
  revealFileAction,
  savePageAction,
} from "@/features/workspace/workspace.action";
import { isResultOk } from "@/lib/protocol/result";
import { useServerAction } from "@/lib/protocol/use-server-action";
import { cn, errorToString, formatBytes } from "@/lib/utils";

/**
 * Renders workspace files; shared by the viewer page (/artifact) and the
 * path-chip dialog. Anything this app can draw opens where the reader already
 * is — a report over the call is still the call's screen, and a new window is
 * one the app cannot close again when they ask it to. What leaves for a tab
 * leaves because they pressed the button that says so; a file the app cannot
 * draw goes to the OS default app.
 */

/**
 * Kinds the browser fills itself, as an element rather than as text. The dialog
 * draws these full-bleed and `FilePreview` never fetches them.
 */
const DRAWS_ITSELF = new Set<FileViewKind>([
  "frame",
  "image",
  "audio",
  "video",
]);

type FileTarget = { how: "dialog"; path: string } | { how: "os" };

export function fileTarget(raw: string): FileTarget {
  const path = workspaceRelative(raw);
  if (!path) return { how: "os" };
  return viewKindOf(path) === "none" ? { how: "os" } : { how: "dialog", path };
}

/** How a file was opened: the reader pressed something, or Thursday put it up on a call. */
type Opening = { path: string; group: string[]; byHer: boolean };

/** Opening a file in the shared dialog; `group` are the files it can be stepped through (one message's images). */
const OpenInDialog = createContext<
  ((path: string, group?: string[], byHer?: boolean) => void) | null
>(null);

/**
 * Opens a file from code (artifact-view), same policy as `FileLink`. `byHer`
 * marks what Thursday put up rather than the reader, which is what the dialog
 * puts on a clock. Returns whether it opened: outside a `FileViewer` it falls
 * back to a tab, which without a user gesture may be blocked.
 */
export function useOpenFile() {
  const inDialog = useContext(OpenInDialog);
  return useCallback(
    (raw: string, group: string[] = [], byHer = false): boolean => {
      const target = fileTarget(raw);
      if (target.how === "os") return false;
      if (inDialog) {
        inDialog(target.path, group, byHer);
        return true;
      }
      return window.open(queryKey.fileView(target.path), "_blank") !== null;
    },
    [inDialog],
  );
}

/** One dialog shared by every link beneath it. */
export function FileViewer({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState<Opening | null>(null);
  const show = useCallback(
    (path: string, group: string[] = [], byHer = false) =>
      setOpen({ path, group, byHer }),
    [],
  );
  return (
    <OpenInDialog value={show}>
      {children}
      <FileDialog
        path={open?.path ?? null}
        group={open?.group ?? []}
        kind={open ? viewKindOf(open.path) : "text"}
        byHer={open?.byHer ?? false}
        onPath={(path) => setOpen((was) => was && { ...was, path })}
        onClose={() => setOpen(null)}
      />
    </OpenInDialog>
  );
}

/** A link to one file; `fileTarget` decides whether this app draws it or the OS does. */
export function FileLink({
  path,
  group,
  className,
  title,
  label,
  children,
}: {
  /** The path as the bot gave it, relative or absolute. */
  path: string;
  /** Files this one can be stepped through in the dialog (one message's images). */
  group?: string[];
  className?: string;
  title?: string;
  /** Accessible name for icon-only links. */
  label?: string;
  children: ReactNode;
}) {
  const target = fileTarget(path);
  const inDialog = useContext(OpenInDialog);
  const [openWithOs, opening] = useServerAction(openFileAction);

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
          if (inDialog) inDialog(target.path, group);
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
  // Opened under a list row, which already sets the edges
  inline: { prose: "pb-3", block: "pb-3" },
};

/** Where the file is read: inside the dialog, on its own page, or opened in place under a row. */
type FileViewPlace = "dialog" | "page" | "inline";

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
 * itself are elements; text kinds fetch and go through `FileBody`; what nothing
 * here draws opens in the computer's own program.
 */
export function FilePreview({ path, bytes }: { path: string; bytes: number }) {
  const kind = viewKindOf(path);
  // Only text kinds are fetched; the rest are elements, or not drawn at all.
  const { content, failure, truncated } = useFileText(
    DRAWS_ITSELF.has(kind) || kind === "none" ? null : path,
  );

  if (kind === "none") return <OwnProgram path={path} />;

  // An `<img>` decodes whole and a huge page cannot be scrolled, and neither
  // says so — it just stops. Audio and video are absent: those stream.
  if (
    (kind === "frame" || kind === "image") &&
    bytes > WORKSPACE_VIEW.elementMax
  ) {
    return <TooBig path={path} bytes={bytes} />;
  }

  if (DRAWS_ITSELF.has(kind)) {
    return <FileElement path={path} kind={kind} where="preview" />;
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

/**
 * A page a bot wrote wears a head that can edit it (skills/shell) and asks the frame
 * showing it to keep what changed. The frame names the file; the page never does. Each
 * page the frame loads is answered with a name for the file it was opened as, and its
 * saves carry that name back, so a save still in flight when the frame moves to another
 * file, or closes, lands in the file it was written from. One listener hears every frame
 * for that reason: a dialog closing takes its component away before the save its page
 * sent on the way out has arrived.
 */
const pages = {
  /** A file → the name its pages are answered with, one per file. */
  named: new Map<string, string>(),
  /** A name → the file it stands for. */
  opened: new Map<string, string>(),
  /** A frame's window → the file it shows now. */
  showing: new WeakMap<Window, string>(),
  listening: false,
};

const hostFor = (path: string) => {
  let as = pages.named.get(path);
  if (!as) {
    as = crypto.randomUUID();
    pages.named.set(path, as);
    pages.opened.set(as, path);
  }
  return { thursday: "host", as };
};

async function hearPages(event: MessageEvent) {
  // A frame's window belongs to its own realm, so it is never `instanceof Window` here
  const from = event.source as Window | null;
  const said = event.data;
  if (!from || event.origin !== location.origin) return;
  if (typeof said?.thursday !== "string") return;
  if (said.thursday === "hello") {
    const path = pages.showing.get(from);
    if (path) from.postMessage(hostFor(path), location.origin);
    return;
  }
  const path = said.thursday === "save" && pages.opened.get(said.as);
  if (!path || typeof said.html !== "string") return;
  const kept = await savePageAction(path, said.html);
  from.postMessage(
    isResultOk(kept)
      ? { thursday: "saved", as: said.as, id: said.id }
      : {
          thursday: "not-saved",
          as: said.as,
          id: said.id,
          error: kept.message,
        },
    location.origin,
  );
}

/**
 * A file the browser fills itself. No sandbox: the html is local and just written
 * by a bot; sandboxing only breaks its forms, fonts and scripts.
 *
 * `takeKeys` hands it the keyboard, where nothing else on screen needs the keys: a
 * deck turns with the arrow keys and a canvas walks its boards the same way, and until
 * the frame holds focus those keys go to the page around it. The element takes it, not
 * `contentWindow` — focusing the window inside leaves this page's body holding the
 * focus — both as this mounts and when the frame loads, since a page rendered by the
 * server has loaded before React listens and one opened in a dialog loads after. The
 * page is told it has a host at both moments too (`pages`, above).
 */
export function FileFrame({
  path,
  className,
  takeKeys,
}: {
  path: string;
  className: string;
  takeKeys?: boolean;
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  const loaded = useCallback(() => {
    if (takeKeys) frame.current?.focus();
    const page = frame.current?.contentWindow;
    if (!page) return;
    pages.showing.set(page, path);
    page.postMessage(hostFor(path), location.origin);
  }, [path, takeKeys]);
  useEffect(loaded, [loaded]);
  useEffect(() => {
    if (pages.listening) return;
    pages.listening = true;
    window.addEventListener("message", hearPages);
  }, []);
  return (
    <iframe
      ref={frame}
      title={path}
      src={queryKey.file(path)}
      allow="clipboard-read; clipboard-write; fullscreen; autoplay"
      className={className}
      onLoad={loaded}
    />
  );
}

/**
 * A kind the browser fills itself, as the element that fills it. One place,
 * because the dialog and the preview draw the same file: they differ only in
 * how much room a picture is given.
 */
function FileElement({
  path,
  kind,
  where,
  takeKeys,
}: {
  path: string;
  kind: FileViewKind;
  where: "dialog" | "preview";
  takeKeys?: boolean;
}) {
  if (kind === "frame") {
    return (
      <FileFrame
        path={path}
        className="h-full w-full bg-white"
        takeKeys={takeKeys}
      />
    );
  }
  if (kind === "image") {
    return (
      // biome-ignore lint/performance/noImgElement: local raw route, nothing to optimize
      <img
        src={queryKey.file(path)}
        alt={path}
        className={
          where === "dialog"
            ? "mx-auto max-h-[calc(100vh-11rem)] object-contain p-4"
            : "mx-auto max-w-full p-6"
        }
      />
    );
  }
  if (kind === "audio") {
    return (
      <audio controls src={queryKey.file(path)} className="w-full p-6">
        <track kind="captions" />
      </audio>
    );
  }
  return (
    <video
      controls
      src={queryKey.file(path)}
      className="mx-auto max-h-full max-w-full p-4"
    >
      <track kind="captions" />
    </video>
  );
}

/** Nothing here draws it — a Word file, a spreadsheet, a deck: it opens where it can be read. */
function OwnProgram({ path }: { path: string }) {
  const [open, opening] = useServerAction(openFileAction);
  return (
    <div className="space-y-4 p-8">
      <p className="max-w-lg text-sm leading-relaxed text-muted-foreground">
        Nothing here can draw this file. It opens in its own program.
      </p>
      <Button variant="outline" loading={opening} onClick={() => open(path)}>
        Open it
      </Button>
    </div>
  );
}

/** Past `elementMax`: the preview says what it is instead of taking the tab down with it. */
function TooBig({ path, bytes }: { path: string; bytes: number }) {
  const [reveal, revealing] = useServerAction(revealFileAction);
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

/**
 * A file she put up rather than the reader closes itself after
 * `WORKSPACE_VIEW.autoCloseMs`, so a report that arrived mid-call gives the
 * screen back without anyone reaching for the mouse. The first real input keeps
 * it for good — it is one cancellation, not a watch, because a page being read
 * gets no input at all, and what happens inside the frame (a report, a pdf) is
 * invisible from out here. A pointer crossing into the dialog and the window
 * losing focus to the frame stand in for that, which is what `keep` is for.
 */
function useAutoClose(armed: boolean, onClose: () => void) {
  const [left, setLeft] = useState<number | null>(null);
  const close = useRef(onClose);
  close.current = onClose;
  const cancel = useRef<() => void>(() => undefined);

  useEffect(() => {
    if (!armed) {
      setLeft(null);
      return;
    }
    let seconds = Math.round(WORKSPACE_VIEW.autoCloseMs / 1000);
    setLeft(seconds);
    const stop = () => {
      window.clearInterval(tick);
      for (const event of ["pointermove", "keydown", "wheel", "blur"])
        window.removeEventListener(event, keep);
      setLeft(null);
    };
    const keep = () => stop();
    const tick = window.setInterval(() => {
      seconds -= 1;
      if (seconds > 0) return setLeft(seconds);
      stop();
      close.current();
    }, 1000);
    for (const event of ["pointermove", "keydown", "wheel", "blur"])
      window.addEventListener(event, keep);
    cancel.current = stop;
    return stop;
  }, [armed]);

  return { left, keep: useCallback(() => cancel.current(), []) };
}

/** A file in a dialog: what the browser draws itself as an element, anything readable fetched from the raw route when opened. */
function FileDialog({
  path,
  group = [],
  kind,
  byHer,
  onPath,
  onClose,
}: {
  /** Workspace-relative path; null means closed. */
  path: string | null;
  /** The files this one sits among, so an image can be stepped through them. */
  group?: string[];
  kind: FileViewKind;
  /** Thursday put it up on a call; the reader did not ask for it, so it closes itself. */
  byHer: boolean;
  onPath?: (path: string) => void;
  onClose: () => void;
}) {
  const image = kind === "image";
  const element = DRAWS_ITSELF.has(kind);
  const { content, failure, truncated } = useFileText(element ? null : path);
  const name = path?.split("/").pop() ?? "";
  const at = path ? group.indexOf(path) : -1;
  const step = (by: number) => {
    if (at < 0 || !onPath) return;
    onPath(group[(at + by + group.length) % group.length]);
  };
  const { left, keep } = useAutoClose(byHer && path !== null, onClose);
  // A page and a video are read at a size of their own; everything else is as tall as it is
  const roomy = kind === "frame" || kind === "video";
  const popup = useRef<HTMLDivElement>(null);

  return (
    <Dialog open={path !== null} onOpenChange={(next) => !next && onClose()}>
      <DialogContent
        ref={popup}
        // One of these opens on its own mid-call, and a ring landing on the first
        // button reads as something to press. The popup takes the key instead.
        initialFocus={popup}
        onKeyDown={(event) => {
          if (event.key === "ArrowLeft") step(-1);
          if (event.key === "ArrowRight") step(1);
        }}
        // The pointer entering the frame is invisible to the window listener
        onPointerOver={keep}
        className={cn(
          "flex flex-col gap-0 overflow-hidden p-0",
          roomy
            ? "h-[min(42rem,calc(100vh-3rem))] sm:max-w-232"
            : "max-h-[calc(100vh-3rem)] sm:max-w-4xl",
        )}
      >
        <DialogTitle className="sr-only">{name}</DialogTitle>

        <div className="flex shrink-0 items-center gap-1 border-b border-border/60 py-2 pr-12 pl-4">
          <span className="min-w-0 flex-1 truncate font-mono text-[12px]">
            {path}
          </span>
          {left !== null && (
            <span className="shrink-0 pr-1 font-mono text-[11px] text-muted-foreground tabular-nums">
              {`Closing in ${left}s`}
            </span>
          )}
          {at >= 0 && group.length > 1 && (
            <>
              <span className="shrink-0 font-mono text-[11px] text-muted-foreground tabular-nums">
                {at + 1} / {group.length}
              </span>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Previous image"
                onClick={() => step(-1)}
              >
                <ChevronLeft />
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Next image"
                onClick={() => step(1)}
              >
                <ChevronRight />
              </Button>
            </>
          )}
          {path && (
            // The one way out of the app, and it is pressed on purpose
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Open in a new tab"
              render={
                <a
                  href={queryKey.fileView(path)}
                  target="_blank"
                  rel="noreferrer"
                />
              }
            >
              <ExternalLink />
            </Button>
          )}
        </div>

        <div
          className={cn(
            "min-h-0 flex-1",
            // A page scrolls inside its own frame; nothing else does
            kind === "frame" ? "overflow-hidden" : "overflow-auto",
          )}
        >
          {element && path ? (
            // A page the reader opened takes the keys; one she put up leaves them to
            // the dialog, whose auto-close waits for a hand the frame would hide
            <FileElement
              path={path}
              kind={kind}
              where="dialog"
              takeKeys={!byHer}
            />
          ) : failure ? (
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

        {image && group.length > 1 && (
          <div className="flex shrink-0 justify-center gap-1.5 border-t border-border/60 p-2.5">
            {group.map((one) => (
              <button
                key={one}
                type="button"
                aria-label={one.split("/").pop()}
                onClick={() => onPath?.(one)}
                className={cn(
                  "size-11 shrink-0 overflow-hidden rounded-md outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                  one === path ? "ring-2 ring-foreground" : "opacity-55",
                )}
              >
                <Image
                  src={queryKey.file(one)}
                  alt=""
                  width={96}
                  height={96}
                  loading="lazy"
                  className="size-full bg-muted object-cover"
                />
              </button>
            ))}
          </div>
        )}
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
  // A column whose every filled cell is a number is read down, not across: right,
  // and tabular so the places line up. A date (2026-07) is not one of these.
  const numeric = useMemo(
    () =>
      (head ?? []).map(
        (_, c) =>
          body.some((row) => (row[c] ?? "").trim() !== "") &&
          body.every((row) => {
            const cell = (row[c] ?? "").trim();
            return cell === "" || /^[+-]?[\d,]*\.?\d+%?$/.test(cell);
          }),
      ),
    [head, body],
  );
  if (!head) return <Plain text={content} className={className} />;

  return (
    <div className={cn("overflow-x-auto", className)}>
      <Table>
        <TableHeader>
          <TableRow>
            {head.map((cell, at) => (
              <TableHead
                key={`${at}-${cell}`}
                className={cn("whitespace-nowrap", numeric[at] && "text-right")}
              >
                {cell}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {body.map((row, r) => (
            <TableRow key={`${r}-${row[0] ?? ""}`}>
              {head.map((_, c) => (
                <TableCell
                  key={`${r}-${c}`}
                  className={cn(
                    "whitespace-nowrap",
                    numeric[c] && "text-right tabular-nums",
                  )}
                >
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
