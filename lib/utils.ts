import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Vendor favicon via Google's favicon service. */
export const faviconUrl = (domain: string) =>
  `https://www.google.com/s2/favicons?domain=${domain}&sz=64`;

/** Collapses whitespace to one line and cuts at `max` characters with an ellipsis. */
export function clip(text: string, max: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat;
}

/** Message of a caught `unknown`, in one line. */
export function errorToString(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/** 1234 → "1.2k", 1234567 → "1.2M". For numbers read only for their size, like tokens. */
export function formatCount(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
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

export const wait = (delay = 0) =>
  new Promise<void>((resolve) => setTimeout(resolve, delay));

export const isFunction = <
  T extends (...args: any[]) => any = (...args: any[]) => any,
>(
  v: unknown,
): v is T => typeof v === "function";

export const isNull = (value: any): value is null | undefined => value == null;

export const groupBy = <T>(arr: T[], getter: keyof T | ((item: T) => string)) =>
  arr.reduce(
    (prev, item) => {
      const key: string =
        getter instanceof Function ? getter(item) : (item[getter] as string);

      if (!prev[key]) prev[key] = [];
      prev[key].push(item);
      return prev;
    },
    {} as Record<string, T[]>,
  );

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
 * success, connected and enabled carry none, so a third would become a brand.
 */
export const WAITING_INK = "text-amber-700 dark:text-amber-400";
