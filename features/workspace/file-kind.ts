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
  /**
   * Nothing of it can be drawn here, so a row opens it in the computer's own
   * program (`file-view` fileTarget). It is still listed: a result the app
   * cannot show is a result all the same. What is never listed is machinery
   * (`isListedFile`).
   */
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

    // An office file a bot left or someone dropped in: no browser draws these,
    // so the row opens them in Word, Excel or PowerPoint. Named here for the
    // mime and so a report naming one gets a chip.
    docx: {
      kind: "none",
      mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    },
    xlsx: {
      kind: "none",
      mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    },
    pptx: {
      kind: "none",
      mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    },

    // Not opened by the screen, but referenced by bot-written html; without a mime the browser gets octet-stream
    css: { kind: "none", mime: TEXT("css") },
    js: { kind: "none", mime: TEXT("javascript") },
    woff2: { kind: "none", mime: "font/woff2" },
  };

export const extensionOf = (path: string) =>
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

/**
 * Files that are machinery rather than work: what a page a bot wrote links to.
 * Anything else is listed, whatever its extension — a bot has a shell, so the
 * table above will always be behind what it can make, and a result nobody can
 * see is a job lost.
 */
const UNLISTED_EXTENSIONS = new Set(["css", "js", "woff2"]);

/**
 * Whether a screen lists a file — the file half of `isListedFolder`. A hidden one is
 * machinery too: Finder's `.DS_Store`, the mark a deleted bot's folder keeps.
 */
export const isListedFile = (name: string): boolean =>
  !name.startsWith(".") && !UNLISTED_EXTENSIONS.has(extensionOf(name));

/** Content-type for the file route; unknown types download. */
export const mimeOf = (path: string): string =>
  TYPE_BY_EXTENSION[extensionOf(path)]?.mime ?? "application/octet-stream";

/** Extensions recognised as paths in report text. Only listed ones: `.js` would turn "Next.js" into a chip. */
const LISTED = Object.keys(TYPE_BY_EXTENSION).filter(
  (extension) => !UNLISTED_EXTENSIONS.has(extension),
);

// The lookbehind class is the body's own, plus `/` and `:`: written as `\w` it
// was ASCII-only, so a name whose first character is not ASCII matched from the
// second one instead, and came back a letter short. The optional leading `/`
// takes an absolute path or a file-route link whole rather than none of it.
const PATH_RE = new RegExp(
  String.raw`(?<![\p{L}\p{N}_/:@%-])\/?(?:[\p{L}\p{N}_.@%-]+/)*[\p{L}\p{N}_@%-]+(?:\.[\p{L}\p{N}_-]+)*\.(?:${LISTED.join("|")})\b`,
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

/**
 * The workspace files a text names, each as it was written. Only what is named: a model that
 * means seven slides names seven (bot.prompt), and a guess at the ones between two names
 * reads a list, a rename or a range in some other language as files nobody picked.
 */
export function pathsIn(text: string): string[] {
  // Strip urls first, or `example.com/price.html` becomes a chip. A scheme on a
  // single slash is a link prefix on a real path (`sandbox:/…`, how a model links
  // a file it wrote): left in place it holds the match off the leading `/`, which
  // then starts inside the path and comes back a folder short.
  const prose = text
    .replace(/\b[a-z][\w+.-]*:\/\/\S+/gi, " ")
    .replace(/\b[a-z][\w+.-]+:(?=\/)/gi, " ");
  const seen = new Set<string>();
  // A list names its folder once, then only the names in it: a bare name is
  // read in the folder of the path before it
  let folder = "";
  for (const [match] of prose.matchAll(PATH_RE)) {
    const bare = !match.includes("/");
    const rel = chipPath(bare ? folder + match : match);
    if (!bare) folder = rel?.slice(0, rel.lastIndexOf("/") + 1) ?? "";
    if (rel) seen.add(rel);
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

/** A finished job's files with the one it leads with (opensOnFinish) first; the rest keep the order they were written in. */
export function leadFirst(files: string[]): string[] {
  const lead = files.findIndex(opensOnFinish);
  return lead > 0
    ? [files[lead], ...files.filter((_, at) => at !== lead)]
    : files;
}
