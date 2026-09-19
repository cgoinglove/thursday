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
  type LucideIcon,
  Music,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { queryKey } from "@/app/api/query-key";
import { Markdown } from "@/components/ui/markdown";
import { FILE_THUMB, WORKSPACE_VIEW } from "@/config";
import { viewKindOf } from "@/features/workspace/file-kind";
import { cn } from "@/lib/utils";

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

export function fileIcon(path: string): LucideIcon {
  const kind = viewKindOf(path);
  // `frame` is two very different things; the extension is what the reader recognises.
  if (kind === "frame") {
    return path.toLowerCase().endsWith(".pdf") ? FileText : FileCode;
  }
  return ICONS[kind] ?? File;
}

/** What a thumbnail can show of a file without opening it. */
type Face = "image" | "page" | "text" | "glyph";

const TEXT_KINDS = new Set(["markdown", "text", "csv", "json"]);

/** Whether a file has a face of its own, or only its glyph. */
export function faceOf(path: string, bytes?: number): Face {
  const kind = viewKindOf(path);
  // Past the cap nothing is drawn as an element, here as in the viewer
  if (bytes !== undefined && bytes > WORKSPACE_VIEW.elementMax) return "glyph";
  if (kind === "image") return "image";
  if (kind === "frame" && /\.html?$/i.test(path)) return "page";
  if (TEXT_KINDS.has(kind)) return "text";
  return "glyph";
}

/**
 * A file's own face, filling whatever box it is given: the image itself, a page in
 * miniature, the head of a text, or the file's glyph. One drawing for the three
 * places a file shows before it is opened — under a message, in the corner where
 * finished work lands, on the Artifacts shelf.
 *
 * A page is the page: the viewer's own iframe at desktop width, scaled down, so it
 * is never a stale picture and needs nothing on the server. It cannot be touched,
 * loads only when it comes into view, and — since it loads without being asked for,
 * unlike the viewer — runs sandboxed, scripts only, apart from the app's origin.
 */
export function FileThumb({
  path,
  bytes,
  glyph = "size-4",
  className,
}: {
  path: string;
  bytes?: number;
  /** The glyph's size, for a file with no face of its own. */
  glyph?: string;
  className?: string;
}) {
  const [broken, setBroken] = useState(false);
  const missing = useCallback(() => setBroken(true), []);
  const face = broken ? "glyph" : faceOf(path, bytes);

  if (face === "image") {
    return (
      // biome-ignore lint/performance/noImgElement: local raw route, nothing to optimize
      <img
        src={queryKey.file(path)}
        alt=""
        loading="lazy"
        decoding="async"
        onError={() => setBroken(true)}
        className={cn("block bg-muted object-cover", className)}
      />
    );
  }
  if (face === "page") {
    return (
      // A page is drawn on white whatever the theme, as it is when opened
      <Shrunk
        width={FILE_THUMB.pageWidth}
        className={cn("bg-white", className)}
      >
        {(height) => (
          <iframe
            title=""
            src={queryKey.file(path)}
            sandbox="allow-scripts"
            loading="lazy"
            tabIndex={-1}
            aria-hidden
            scrolling="no"
            style={{ width: FILE_THUMB.pageWidth, height }}
            className="pointer-events-none block border-0 bg-white"
          />
        )}
      </Shrunk>
    );
  }
  if (face === "text") {
    return (
      <Shrunk
        width={FILE_THUMB.textWidth}
        className={cn("bg-background", className)}
      >
        {() => <TextHead path={path} onMissing={missing} />}
      </Shrunk>
    );
  }
  const Icon = fileIcon(path);
  return (
    <span
      className={cn(
        "grid place-items-center bg-muted text-muted-foreground",
        className,
      )}
    >
      <Icon className={glyph} />
    </span>
  );
}

/**
 * Content laid out `width` wide and scaled to the box it is in. The box is measured,
 * since a scale is a number and CSS cannot divide one length by another everywhere.
 */
function Shrunk({
  width,
  className,
  children,
}: {
  width: number;
  className?: string;
  children: (height: number) => React.ReactNode;
}) {
  const box = useRef<HTMLSpanElement>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  // Before paint, so a tile is never empty for a frame
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const measure = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const watch = new ResizeObserver(measure);
    watch.observe(el);
    return () => watch.disconnect();
  }, []);
  const scale = size ? size.w / width : 0;

  return (
    <span
      ref={box}
      aria-hidden
      className={cn("relative block overflow-hidden", className)}
    >
      {scale > 0 && size && (
        <span
          className="absolute top-0 left-0 block origin-top-left"
          style={{ width, transform: `scale(${scale})` }}
        >
          {children(Math.ceil(size.h / scale))}
        </span>
      )}
    </span>
  );
}

/** The head of a text file (FILE_THUMB.textBytes of it), drawn as the viewer draws the whole. */
function TextHead({
  path,
  onMissing,
}: {
  path: string;
  onMissing: () => void;
}) {
  const [text, setText] = useState<string | null>(null);
  useEffect(() => {
    const stop = new AbortController();
    fetch(queryKey.file(path), {
      headers: { range: `bytes=0-${FILE_THUMB.textBytes - 1}` },
      signal: stop.signal,
    })
      .then((response) => (response.ok ? response.text() : Promise.reject()))
      // a cut in the middle of a character leaves one replacement mark at the end
      .then((head) => setText(head.replace(/\uFFFD+$/, "")))
      .catch(() => {
        if (!stop.signal.aborted) onMissing();
      });
    return () => stop.abort();
  }, [path, onMissing]);

  if (text === null) return null;
  return viewKindOf(path) === "markdown" ? (
    <div className="pointer-events-none px-9 py-8 text-[15px] text-foreground">
      {/* A face, not a reader: the tile it sits in is a button, which may hold no other —
          so no copy or download controls, and a link is drawn without being one */}
      <Markdown controls={false} components={{ a: "span" }}>
        {text}
      </Markdown>
    </div>
  ) : (
    <pre className="pointer-events-none px-7 py-6 font-mono text-[13px] leading-relaxed whitespace-pre-wrap text-foreground">
      {text}
    </pre>
  );
}
