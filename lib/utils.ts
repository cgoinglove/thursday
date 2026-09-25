import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Collapses whitespace to one line and cuts at `max` characters with an ellipsis. */
export function clip(text: string, max: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat;
}

/** How much of a thrown object with no words of its own is worth reading back. */
const THROWN_JSON_MAX = 300;

/**
 * Message of a caught `unknown`, in one line. Not everything thrown is an Error: a
 * provider's streamed failure arrives as its parsed body, with the words in `message`
 * or one `error` down, and an object without either reads back as its JSON.
 */
export function errorToString(cause: unknown): string {
  if (cause instanceof Error) return cause.message;
  if (typeof cause !== "object" || cause === null) return String(cause);
  const { message, error } = cause as { message?: unknown; error?: unknown };
  if (typeof message === "string" && message) return message;
  if (typeof error === "string" && error) return error;
  const inner = (error as { message?: unknown } | null | undefined)?.message;
  if (typeof inner === "string" && inner) return inner;
  try {
    return clip(JSON.stringify(cause), THROWN_JSON_MAX);
  } catch {
    // A cycle or a bigint: no JSON, and the constructor is all there is to name
    return `${cause.constructor?.name ?? "Object"} thrown without a message`;
  }
}

/** 1234 → "1.2k", 1234567 → "1.2M". For numbers read only for their size, like tokens. */
export function formatCount(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

/** 900 → "900 B", 12345 → "12.1 KB", 5e9 → "4.7 GB". Binary units; the OS reports the same. */
export function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = size / 1024;
  let at = 0;
  while (value >= 1024 && at < units.length - 1) {
    value /= 1024;
    at += 1;
  }
  return `${value.toFixed(value < 10 ? 1 : 0)} ${units[at]}`;
}

/** `https://www.tenki.jp/…` → `tenki.jp`; null for a URL that does not parse. */
export function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

/** Markdown as plain text for a one-line preview: strips headings, emphasis, code, links and table rules. */
export function plainText(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^\s{0,3}(#{1,6}\s+|[-*+]\s+|\d+\.\s+|>\s?)/gm, "")
    .replace(/(\*\*|__)(.*?)\1/g, "$2")
    .replace(/(\*|_)(.*?)\1/g, "$2")
    .replace(/^\s*\|?[\s:|-]+\|\s*$/gm, " ")
    .replace(/\|/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** A link as written in Markdown: `[label](href)`. */
export const MARKDOWN_LINK = /\[([^\]\n]+)\]\(([^)\s]+)\)/g;

/**
 * Markdown as a caption: the marks go as in `plainText`, but the lines a list or a table is
 * made of stay lines (a table row as its cells with " · " between, its rule dropped) and a
 * link keeps its `[label](href)` for the caption to draw as one. Emphasis is taken off around
 * links, never inside them: a file name's underscores are part of where it leads.
 */
export function captionText(markdown: string): string {
  const links: string[] = [];
  const bare = markdown
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(MARKDOWN_LINK, (_, label: string, href: string) => {
      links.push(`[${label.replace(/[*_`]/g, "")}](${href})`);
      return `\uE000${links.length - 1}\uE000`;
    });
  const lines: string[] = [];
  for (const raw of bare.split("\n")) {
    let line = raw.trim();
    if (!line) continue;
    // A table's rule, the row under its head, or a rule across the page
    if (/^\|?[\s:|-]+\|[\s:|-]*$|^[-*_]{3,}$/.test(line)) continue;
    if (/\|.*\|/.test(line))
      line = line
        .replace(/^\||\|$/g, "")
        .split("|")
        .map((cell) => cell.trim())
        .filter(Boolean)
        .join(" · ");
    line = line
      .replace(/^#{1,6}\s+/, "")
      .replace(/^>\s?/, "")
      .replace(/^[-*+]\s+/, "• ")
      .replace(/`([^`]*)`/g, "$1")
      .replace(/(\*\*|__)(\S(?:.*?\S)?)\1/g, "$2")
      // Only a mark that opens and closes on a word: snake_case keeps its underscores
      .replace(/(^|[^\w*])([*_])(\S(?:[^*_\n]*?\S)?)\2(?![\w*])/g, "$1$3")
      .replace(/\s+/g, " ");
    lines.push(line);
  }
  return lines
    .join("\n")
    .replace(/\uE000(\d+)\uE000/g, (_, at: string) => links[Number(at)] ?? "");
}

export const isFunction = <
  T extends (...args: any[]) => any = (...args: any[]) => any,
>(
  v: unknown,
): v is T => typeof v === "function";

/** Runs async functions one at a time in order. A failure does not break the chain. */
export const PromiseChain = () => {
  let promise: Promise<any> = Promise.resolve();
  return <T>(asyncFunction: () => Promise<T>): Promise<T> => {
    const resultPromise = promise.then(() => asyncFunction());
    promise = resultPromise.catch(() => {});
    return resultPromise;
  };
};

/**
 * "Waiting on me" ink. The other status colour is `text-destructive` (failed);
 * success, connected and enabled carry none. Blue is no status: it is the brand
 * (`bg-brand`), the one thing a screen asks for and Thursday herself.
 */
export const WAITING_INK = "text-waiting";
