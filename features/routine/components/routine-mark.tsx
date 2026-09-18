import { Repeat } from "lucide-react";

/**
 * The glyph of something that starts by itself: the settings nav, a routine's row, and
 * every job a routine opened, in Threads and in the room.
 */
export function RoutineMark({ className }: { className?: string }) {
  return <Repeat className={className} aria-hidden="true" />;
}
