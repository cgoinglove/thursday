"use client";

import { X } from "lucide-react";
import { useEffect, useState } from "react";
import { useAppEvent } from "@/app/api/events/app-event.client";
import { queryKey } from "@/app/api/query-key";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useServerRoute } from "@/lib/protocol/use-server-route";
import type { MemoryNote } from "../memory.schema";
import { noteTitle } from "../memory.schema";

/**
 * Read-only note panel opened by the `memory-view` event during a call.
 * Deliberately has no edit controls; the `memory` signal keeps it current.
 */
export function MemoryView() {
  const [path, setPath] = useState<string | null>(null);

  useAppEvent({
    "memory-view": (event) => setPath(event.path),
  });

  useEffect(() => {
    if (!path) return;
    const onEscape = (event: KeyboardEvent) =>
      event.key === "Escape" && setPath(null);
    window.addEventListener("keydown", onEscape);
    return () => window.removeEventListener("keydown", onEscape);
  }, [path]);

  const { data: note, isLoading } = useServerRoute<MemoryNote>(
    path ? queryKey.notePath(path) : null,
  );

  if (!path) return null;

  return (
    <div className="absolute top-16 right-4 z-20 flex max-h-[min(32rem,calc(100vh-8rem))] w-[min(24rem,calc(100vw-2rem))] flex-col rounded-lg border bg-background/95 shadow-lg backdrop-blur">
      <div className="flex items-start gap-2 border-b p-3">
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">{noteTitle(path)}</div>
          <div className="truncate text-xs text-muted-foreground">
            {note?.description ?? path}
          </div>
        </div>
        <Button
          size="icon-xs"
          variant="ghost"
          aria-label="Close"
          onClick={() => setPath(null)}
        >
          <X />
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {isLoading && !note ? (
          <div className="space-y-2">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-4/5" />
            <Skeleton className="h-4 w-3/5" />
          </div>
        ) : note?.facts.length ? (
          // Numbered so a fact can be referred to by voice.
          <ol className="space-y-1.5">
            {note.facts.map((fact, index) => (
              <li key={fact.id} className="flex gap-2 text-sm leading-snug">
                <span className="w-4 shrink-0 text-right font-mono text-[11px] text-muted-foreground/70">
                  {index + 1}
                </span>
                <span className="min-w-0">{fact.text}</span>
              </li>
            ))}
          </ol>
        ) : (
          <div className="text-sm text-muted-foreground">
            Nothing left here.
          </div>
        )}
      </div>
    </div>
  );
}
