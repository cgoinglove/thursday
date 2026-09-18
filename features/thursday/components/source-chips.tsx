"use client";

import { useState } from "react";
import { queryKey } from "@/app/api/query-key";
import { cn } from "@/lib/utils";
import type { SearchedSource } from "../tool-line";

/** `https://www.tenki.jp/…` → `tenki.jp`; null for a URL that does not parse. */
function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

/**
 * The pages a web search read, as chips that open them in a new tab: the site's icon
 * and its name. The icon is fetched by this server (lib/favicon), never by the browser
 * from the site or a third party. `limit` keeps a one-line row one line; the rest are
 * counted beside it.
 */
export function SourceChips({
  sources,
  limit,
  className,
}: {
  sources: SearchedSource[];
  limit?: number;
  className?: string;
}) {
  const pages = sources.flatMap((source) => {
    const host = hostOf(source.url);
    return host ? [{ ...source, host }] : [];
  });
  const shown = limit ? pages.slice(0, limit) : pages;
  const more = pages.length - shown.length;
  return (
    <span
      className={cn("flex min-w-0 flex-wrap items-center gap-1", className)}
    >
      {shown.map((page) => (
        <a
          key={page.url}
          href={page.url}
          target="_blank"
          rel="noreferrer"
          title={page.title ?? page.url}
          className="flex h-[22px] min-w-0 items-center gap-1.5 rounded-full bg-muted pr-2 pl-1 text-[11.5px] leading-4 text-foreground/80 outline-none transition-colors hover:bg-accent focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <SiteIcon host={page.host} />
          <span className="truncate">{page.host}</span>
        </a>
      ))}
      {more > 0 && (
        <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
          +{more}
        </span>
      )}
    </span>
  );
}

/** The site's icon, or its first letter when the server found none. */
function SiteIcon({ host }: { host: string }) {
  const [missing, setMissing] = useState(false);
  if (missing)
    return (
      <span
        aria-hidden
        className="grid size-3.5 shrink-0 place-items-center rounded-[4px] bg-foreground/10 text-[8.5px] font-medium text-foreground/70 uppercase"
      >
        {host[0]}
      </span>
    );
  return (
    // biome-ignore lint/performance/noImgElement: a 14px icon from this server's own route
    <img
      src={queryKey.favicon(host)}
      alt=""
      width={14}
      height={14}
      onError={() => setMissing(true)}
      className="size-3.5 shrink-0 rounded-[4px]"
    />
  );
}
