"use client";

import { type ReactNode, useState } from "react";
import { queryKey } from "@/app/api/query-key";
import { cn } from "@/lib/utils";

/** `https://www.tenki.jp/…` → `tenki.jp`; null for a URL that does not parse. */
export function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

/**
 * A site's own icon, fetched by this server (lib/favicon) so neither the site nor a
 * third party learns what is on screen. A site that gives none draws `fallback`, or
 * its first letter.
 */
export function SiteIcon({
  host,
  className = "size-3.5 rounded-[4px]",
  fallback,
}: {
  host: string;
  className?: string;
  fallback?: ReactNode;
}) {
  const [missing, setMissing] = useState(false);
  if (missing)
    return (
      fallback ?? (
        <span
          aria-hidden
          className={cn(
            "grid shrink-0 place-items-center bg-foreground/10 text-[8.5px] font-medium text-foreground/70 uppercase",
            className,
          )}
        >
          {host[0]}
        </span>
      )
    );
  return (
    // biome-ignore lint/performance/noImgElement: a small icon from this server's own route
    <img
      src={queryKey.favicon(host)}
      alt=""
      onError={() => setMissing(true)}
      className={cn("shrink-0", className)}
    />
  );
}
