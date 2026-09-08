"use client";

import useSWR, { mutate, type SWRConfiguration, type SWRResponse } from "swr";
import { toast } from "@/components/ui/toast";
import { errorToString } from "@/lib/utils";
import { isResult, unwrapResult } from "./result";

/**
 * An SWR key for a `serverRoute` endpoint. The hook assembles the URL:
 *
 *   { url: "/api/memory" }
 *   { url: "/api/memory", pathVariable: [id] }        → /api/memory/3
 *   { url: "/api/files", query: { dir: "a b" } }      → /api/files?dir=a+b
 */
export type RouteKey = {
  url: string;
  pathVariable?: Array<string | number | null | undefined>;
  query?: Record<string, string | number | boolean | null | undefined>;
};

export type KeyInput = string | RouteKey | null | undefined | false;

/** Does an SWR key point at this url or something under it? `/api/memory` matches every `/api/memory/<id>`. */
function keyMatches(key: unknown, url: string) {
  if (typeof key === "string") return key.startsWith(url);
  const target = (key as RouteKey | null)?.url;
  return typeof target === "string" && target.startsWith(url);
}

/**
 * Mounted paged readers (use-server-pages). swr's filter mutate skips `$inf$`
 * keys and the per-page entries have no hook to revalidate, so `revalidate`
 * calls each reader's own `mutate()` by url instead.
 */
type PagedReader = { url: string; refresh: () => Promise<unknown> };
const pagedReaders = new Set<PagedReader>();

/** Returns the unregister for the effect's cleanup. */
export function registerPagedReader(reader: PagedReader) {
  pagedReaders.add(reader);
  return () => {
    pagedReaders.delete(reader);
  };
}

const refreshPaged = (url: string) =>
  [...pagedReaders]
    .filter((reader) => reader.url.startsWith(url))
    .map((reader) => reader.refresh());

// A falsy key, or a missing path variable, stops the fetch (SWR conditional).
export function resolveKey(key: KeyInput): string | RouteKey | null {
  if (!key) return null;
  if (typeof key !== "string" && key.pathVariable?.some((v) => v == null)) {
    return null;
  }
  return key;
}

function buildUrl(key: string | RouteKey): string {
  if (typeof key === "string") return key;

  const segments = (key.pathVariable ?? []).map((value) =>
    encodeURIComponent(String(value)),
  );
  const path = [key.url, ...segments].join("/");

  const search = new URLSearchParams();
  for (const [name, value] of Object.entries(key.query ?? {})) {
    if (value != null) search.set(name, String(value));
  }
  const qs = search.toString();
  return qs ? `${path}?${qs}` : path;
}

/** Fetch, then unwrap the Result wire. A non-Result body passes through. */
export async function fetchRoute(key: string | RouteKey): Promise<unknown> {
  const response = await fetch(buildUrl(key));
  const text = await response.text();
  let body: unknown;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    // A non-JSON body is not a valid read
    throw new Error(`Unexpected response (${response.status})`);
  }
  if (isResult(body)) return unwrapResult(body);
  if (!response.ok) throw new Error(`Request failed (${response.status})`);
  return body;
}

/**
 * Read defaults. The server is on this machine and its data is written by
 * things the browser cannot see (a voice tool, a bot, a watcher), so a read is
 * cheap and a stale screen is the expensive one: every return to the tab
 * re-reads. Freshness while the tab is open comes from the event stream
 * (app-event.client); these cover the gaps around it.
 *
 * The deduping window collapses the readers that mount together on one key
 * (four of them share `queryKey.config`) and holds nothing back beyond that —
 * what makes a read stale is `revalidateIfStale`, which stays on.
 */
const READ_DEFAULTS = {
  dedupingInterval: 500,
  revalidateOnFocus: true,
  revalidateOnReconnect: true,
  focusThrottleInterval: 1000,
} as const;

/** Focus revalidation retries a broken endpoint; do not toast every time. */
const lastToastAt = new Map<string, number>();
const TOAST_COOLDOWN_MS = 30_000;

function toastReadError(error: unknown, key: string) {
  const now = Date.now();
  if (now - (lastToastAt.get(key) ?? 0) < TOAST_COOLDOWN_MS) return;
  lastToastAt.set(key, now);
  toast.add({
    type: "error",
    title: "Failed to load",
    description: errorToString(error),
  });
}

/**
 * Client twin of `serverRoute`: `useSWR` over a structured key. `T` is the
 * response type as serialized on the wire (no runtime validation). Failures
 * throw with the server's `Result` message and toast themselves (pass `onError` to override).
 *
 * ```ts
 * const { data } = useServerRoute<MemoryNote[]>(KEY);
 * const { data } = useServerRoute<MemoryNote>({ url: KEY, pathVariable: [id] });
 * ```
 */
export function useServerRoute<T = unknown>(
  key: KeyInput,
  options?: SWRConfiguration<T>,
): SWRResponse<T, Error> {
  return useSWR<T>(
    resolveKey(key),
    fetchRoute as (key: string | RouteKey) => Promise<T>,
    {
      ...READ_DEFAULTS,
      ...options,
      onError: options?.onError ?? toastReadError,
    },
  );
}

/** Refresh this key and every read under it. Called by the writer from its own onOk. */
export function revalidate(key: string | RouteKey) {
  const url = typeof key === "string" ? key : key.url;
  return Promise.all([
    mutate((entry) => keyMatches(entry, url)),
    ...refreshPaged(url),
  ]);
}

/** Re-read everything, for when the server comes back. */
export const revalidateAll = () =>
  Promise.all([
    mutate(() => true),
    ...[...pagedReaders].map((reader) => reader.refresh()),
  ]);
