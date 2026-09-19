/**
 * Extension to how the screen renders it and the content-type it is served
 * with, plus which folders are worth listing. Shared by server and client.
 */

import { queryKey } from "@/app/api/query-key";
import { PATHS } from "@/config";

export type FileViewKind =
  | "markdown"
  | "csv"
  | "json"
  | "text"
  /** Renders itself in an iframe (html, pdf). */
  | "frame"
  | "image"
  /** Played by the browser's own element; /api/file serves Range for seeking. */
  | "audio"
  | "video"
  /** Left to the OS default app. */
  | "none";

const TEXT = (type: string) => `text/${type}; charset=utf-8`;

const TYPE_BY_EXTENSION: Record<string, { kind: FileViewKind; mime: string }> =
  {
    md: { kind: "markdown", mime: TEXT("markdown") },
    markdown: { kind: "markdown", mime: TEXT("markdown") },
    csv: { kind: "csv", mime: TEXT("csv") },
    json: { kind: "json", mime: "application/json; charset=utf-8" },
    txt: { kind: "text", mime: TEXT("plain") },
    log: { kind: "text", mime: TEXT("plain") },
    html: { kind: "frame", mime: TEXT("html") },
    htm: { kind: "frame", mime: TEXT("html") },
    pdf: { kind: "frame", mime: "application/pdf" },
    png: { kind: "image", mime: "image/png" },
    jpg: { kind: "image", mime: "image/jpeg" },
    jpeg: { kind: "image", mime: "image/jpeg" },
    gif: { kind: "image", mime: "image/gif" },
    webp: { kind: "image", mime: "image/webp" },
    svg: { kind: "image", mime: "image/svg+xml" },

    // What studio writes (studio.tool): the browser plays these itself.
    mp3: { kind: "audio", mime: "audio/mpeg" },
    wav: { kind: "audio", mime: "audio/wav" },
    mp4: { kind: "video", mime: "video/mp4" },
    webm: { kind: "video", mime: "video/webm" },

    // Not opened by the screen, but referenced by bot-written html; without a mime the browser gets octet-stream
    css: { kind: "none", mime: TEXT("css") },
    js: { kind: "none", mime: TEXT("javascript") },
    woff2: { kind: "none", mime: "font/woff2" },
  };

const extensionOf = (path: string) =>
  path.split(".").pop()?.toLowerCase() ?? "";

export const viewKindOf = (path: string): FileViewKind =>
  TYPE_BY_EXTENSION[extensionOf(path)]?.kind ?? "none";

/**
 * Folders that are machinery rather than work: what a package manager
 * installs, and what tools leave beside it. Hidden names cover the app's own
 * (`.output`, `.playwright-cli`) and the skills folder, which has its own
 * section. Adding a name here takes the folder off the Workspace screen.
 */
const UNLISTED_FOLDERS = new Set(["node_modules", "__pycache__"]);

/** Whether the Workspace section lists a folder — the folder half of `viewKindOf`. */
export const isListedFolder = (name: string): boolean =>
  !name.startsWith(".") && !UNLISTED_FOLDERS.has(name);

/** Content-type for the file route; unknown types download. */
export const mimeOf = (path: string): string =>
  TYPE_BY_EXTENSION[extensionOf(path)]?.mime ?? "application/octet-stream";

/** Extensions recognised as paths in report text. Only viewable ones: `.js` would turn "Next.js" into a chip. */
const VIEWABLE = Object.entries(TYPE_BY_EXTENSION)
  .filter(([, type]) => type.kind !== "none")
  .map(([extension]) => extension);

// The lookbehind class is the body's own, plus `/` and `:`: written as `\w` it
// was ASCII-only, so a name whose first character is not ASCII matched from the
// second one instead, and came back a letter short. The optional leading `/`
// takes an absolute path or a file-route link whole rather than none of it.
const PATH_RE = new RegExp(
  String.raw`(?<![\p{L}\p{N}_/:@%-])\/?(?:[\p{L}\p{N}_.@%-]+/)*[\p{L}\p{N}_@%-]+(?:\.[\p{L}\p{N}_-]+)*\.(?:${VIEWABLE.join("|")})\b`,
  "giu",
);

const WORKSPACE_MARK = `${PATHS.workspace}/`;

const FILE_ROUTE = queryKey.file("");

/** A link to the file route names the workspace file it serves. */
function fromFileRoute(path: string): string {
  if (!path.startsWith(FILE_ROUTE)) return path;
  const rest = path.slice(FILE_ROUTE.length);
  try {
    return decodeURIComponent(rest);
  } catch {
    return rest;
  }
}

/** Folds a path inside the workspace to a relative one; null when it points outside. */
export function workspaceRelative(raw: string): string | null {
  const path = fromFileRoute(raw.trim());
  const at = path.indexOf(WORKSPACE_MARK);
  if (at >= 0) return path.slice(at + WORKSPACE_MARK.length) || null;
  if (path.startsWith("/") || /^[A-Za-z]:/.test(path)) return null;
  if (path.split("/").includes("..")) return null;
  return path || null;
}

function chipPath(raw: string): string | null {
  const rel = workspaceRelative(raw);
  if (!rel) return null;
  // A dot in the first segment is a host, not a folder (`www.apple.com/x.html`)
  const [head, ...rest] = rel.split("/");
  return rest.length && head.includes(".") ? null : rel;
}

/** What stands between two names when the first runs on to the second: "slide_1.png ~ slide_7.png". */
const RUNS_TO = /^[\s`'"*_)]*(?:~|–|—|-|\.{2,}|…|to|through)[\s`'"*_(]*$/i;

/**
 * The names a run leaves out: `slide_1.png ~ slide_7.png` is seven files said as two. Only
 * when both ends differ by their last number alone, and by few enough to be a list.
 */
function between(from: string, to: string): string[] {
  const parts = (path: string) => /^(.*?)(\d+)(\D*)$/.exec(path);
  const a = parts(from);
  const b = parts(to);
  if (!a || !b || a[1] !== b[1] || a[3] !== b[3]) return [];
  const first = Number(a[2]);
  const last = Number(b[2]);
  if (!(last - first > 1) || last - first > 12) return [];
  // `01` runs on as `02`; `1` as `2`
  const width = a[2].startsWith("0") ? a[2].length : 0;
  return Array.from(
    { length: last - first - 1 },
    (_, at) => `${a[1]}${String(first + at + 1).padStart(width, "0")}${a[3]}`,
  );
}

export function pathsIn(text: string): string[] {
  // Strip urls first, or `example.com/price.html` becomes a chip
  const prose = text.replace(/\b[a-z][\w+.-]*:\/\/\S+/gi, " ");
  const seen = new Set<string>();
  // A list names its folder once, then only the names in it: a bare name is
  // read in the folder of the path before it
  let folder = "";
  let before: { rel: string; end: number } | null = null;
  for (const found of prose.matchAll(PATH_RE)) {
    const match = found[0];
    const bare = !match.includes("/");
    const rel = chipPath(bare ? folder + match : match);
    if (!bare) folder = rel?.slice(0, rel.lastIndexOf("/") + 1) ?? "";
    if (!rel) continue;
    if (before && RUNS_TO.test(prose.slice(before.end, found.index)))
      for (const one of between(before.rel, rel)) seen.add(one);
    seen.add(rel);
    before = { rel, end: found.index + match.length };
  }
  return [...seen].slice(0, 12);
}

/**
 * The file a finished job's notice leads with: a page to read among their finished work. Anything
 * else a report names — a data file, a bot's own memory, a sign-in state — follows it. Nothing
 * opens by itself; the corner waits for the user (workspace/components/artifact-view).
 */
export const opensOnFinish = (path: string): boolean =>
  path.startsWith(`${PATHS.artifacts}/`) &&
  ["md", "markdown", "html", "htm"].includes(extensionOf(path));
