"use client";

import { useEffect, useRef } from "react";
import useSWRInfinite, { type SWRInfiniteConfiguration } from "swr/infinite";
import { PAGE_SIZE } from "@/config";
import { useOnVisible } from "@/hooks/use-on-visible";
import {
  fetchRoute,
  type KeyInput,
  registerPagedReader,
  resolveKey,
} from "./use-server-route";

/**
 * Paged reads over `serverRoute` with an intersection observer as the trigger.
 * Wraps SWR's infinite hook with the shared page size and `Result` unwrapping;
 * how a page is addressed (cursor or offset) is the caller's key function.
 */

export type ServerPages<T> = {
  /** Every page so far, flattened. */
  items: T[];
  /** The first read is still out. */
  isLoading: boolean;
  /** A later page is out. */
  isLoadingMore: boolean;
  error: Error | undefined;
  /** The last page came back full, so there is probably another. */
  hasMore: boolean;
  /** Put on an element at the end of the list; the next page is requested when it comes into view. */
  sentinelRef: (node: HTMLElement | null) => void;
  /** Re-read every loaded page. */
  refresh: () => Promise<unknown>;
};

export function useServerPages<T>(options: {
  /** The key for one page. `previous` is the page before it (null on the first). Return null to stop. */
  key: (index: number, previous: T[] | null) => KeyInput;
  /** Rows per page. Defaults to PAGE_SIZE. */
  size?: number;
  swr?: SWRInfiniteConfiguration;
}): ServerPages<T> {
  const size = options.size ?? PAGE_SIZE;
  const { key } = options;

  const { data, error, isLoading, isValidating, setSize, mutate } =
    useSWRInfinite<T[]>(
      ((index: number, previous: T[] | null) =>
        resolveKey(key(index, previous))) as never,
      fetchRoute as never,
      {
        // Same defaults as one-shot reads (use-server-route READ_DEFAULTS);
        // the first page is not re-read on every scroll, `mutate()` still forces all
        dedupingInterval: 500,
        revalidateOnFocus: true,
        revalidateOnReconnect: true,
        focusThrottleInterval: 1000,
        revalidateFirstPage: false,
        ...options.swr,
      },
    );

  const pages = data ?? [];
  const items = pages.flat();
  const last = pages.at(-1);
  // A short page is the end; a count landing on a boundary costs one empty read
  const hasMore = last === undefined ? false : last.length >= size;
  // `isValidating` alone is true for any read in flight (polling included), so
  // "loading more" is only when a page beyond what we have was asked for
  const asked = useRef(0);
  const isLoadingMore =
    isValidating && pages.length > 0 && asked.current > pages.length;

  // Ref so the observer reads current values, not those at attach time
  const state = useRef({ isValidating, setSize, pages: pages.length });
  state.current = { isValidating, setSize, pages: pages.length };

  // swr's filter mutate cannot reach an infinite key, so the reader registers
  // its first page's url and `revalidate` refreshes it by url
  const first = resolveKey(key(0, null));
  const url = typeof first === "string" ? first : first?.url;
  useEffect(() => {
    if (!url) return;
    return registerPagedReader({ url, refresh: () => mutate() });
  }, [url, mutate]);

  const sentinelRef = useOnVisible(
    () => {
      const now = state.current;
      if (now.isValidating) return;
      asked.current = now.pages + 1;
      void now.setSize(now.pages + 1);
    },
    // Re-armed when a page lands: on a short list the sentinel never leaves the screen
    { enabled: hasMore, revision: `${pages.length}:${isValidating}` },
  );

  return {
    items,
    isLoading,
    isLoadingMore,
    error,
    hasMore,
    sentinelRef,
    refresh: () => mutate(),
  };
}
