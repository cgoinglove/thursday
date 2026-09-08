/** Extension to how the screen renders it and the content-type it is served with. Shared by server and client. */

import { PATHS } from "@/config";

export type FileViewKind =
  | "markdown"
  | "csv"
  | "json"
  | "text"
  /** Renders itself in an iframe (html, pdf). */
  | "frame"
  | "image"
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

    // Not opened by the screen, but referenced by bot-written html; without a mime the browser gets octet-stream
    css: { kind: "none", mime: TEXT("css") },
    js: { kind: "none", mime: TEXT("javascript") },
    woff2: { kind: "none", mime: "font/woff2" },
    mp3: { kind: "none", mime: "audio/mpeg" },
    mp4: { kind: "none", mime: "video/mp4" },
    webm: { kind: "none", mime: "video/webm" },
  };

const extensionOf = (path: string) =>
  path.split(".").pop()?.toLowerCase() ?? "";

export const viewKindOf = (path: string): FileViewKind =>
  TYPE_BY_EXTENSION[extensionOf(path)]?.kind ?? "none";

/** Content-type for the file route; unknown types download. */
export const mimeOf = (path: string): string =>
  TYPE_BY_EXTENSION[extensionOf(path)]?.mime ?? "application/octet-stream";

/** Extensions recognised as paths in report text. Only viewable ones: `.js` would turn "Next.js" into a chip. */
const VIEWABLE = Object.entries(TYPE_BY_EXTENSION)
  .filter(([, type]) => type.kind !== "none")
  .map(([extension]) => extension);

// The lookbehind class is the body's own, plus `/` and `:`: written as `\w` it
// was ASCII-only, so a path starting mid-word in any other script matched with
// its first letter eaten — `artifacts/가을.html` came back as `을.html`
const PATH_RE = new RegExp(
  String.raw`(?<![\p{L}\p{N}_/:@%-])(?:[\p{L}\p{N}_.@%-]+/)*[\p{L}\p{N}_@%-]+(?:\.[\p{L}\p{N}_-]+)*\.(?:${VIEWABLE.join("|")})\b`,
  "giu",
);

const WORKSPACE_MARK = `${PATHS.workspace}/`;

/** Folds a path inside the workspace to a relative one; null when it points outside. */
export function workspaceRelative(raw: string): string | null {
  const path = raw.trim();
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

export function pathsIn(text: string): string[] {
  // Strip urls first, or `example.com/price.html` becomes a chip
  const prose = text.replace(/\b[a-z][\w+.-]*:\/\/\S+/gi, " ");
  const seen = new Set<string>();
  for (const match of prose.match(PATH_RE) ?? []) {
    const rel = chipPath(match);
    if (rel) seen.add(rel);
  }
  return [...seen].slice(0, 6);
}
