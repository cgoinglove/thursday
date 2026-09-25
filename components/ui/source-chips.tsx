"use client";

import { SiteIcon } from "@/components/ui/site-icon";
import { cn, hostOf } from "@/lib/utils";

/** A page a search read: where it is, and what it is called when that is known. */
export type SourcePage = { url: string; title?: string };

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
  sources: SourcePage[];
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
