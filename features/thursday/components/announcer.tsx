"use client";

import { useEffect, useRef, useState } from "react";
import { useAppEvent } from "@/app/api/events/app-event.client";
import type { Turn } from "@/features/thursday/components/side-captions";

/**
 * What a screen reader says as it happens on the call screen: her turn once she has finished
 * it, and a job that ended. Her captions are words drawn as they come and the corner's card a
 * picture of the ending, so neither was announced (UX test: her answer and two job endings,
 * 3/3). Drawn nowhere; one polite line at a time, never her words piece by piece.
 */
export function Announcer({
  turns,
  saying,
}: {
  turns: Turn[];
  saying: boolean;
}) {
  const [line, setLine] = useState("");
  const told = useRef<string | null>(null);
  const last = turns.at(-1);

  useEffect(() => {
    if (!last || last.role !== "assistant" || saying) return;
    const key = `${last.id}:${last.text.length}`;
    if (told.current === key) return;
    told.current = key;
    setLine(last.text);
  }, [last, saying]);

  useAppEvent({
    finished: (event) => setLine(`${event.bot} finished: ${event.label}`),
  });

  return (
    <div role="status" aria-live="polite" className="sr-only">
      {line}
    </div>
  );
}
