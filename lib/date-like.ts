import { format, isToday, isYesterday } from "date-fns";
import { z } from "zod";

/**
 * A timestamp on both sides of the wire: drizzle returns a `Date`, JSON carries
 * an ISO string. Responses are not parsed at runtime, so `z.coerce.date()`
 * would give the client a `Date`-only type it cannot rely on.
 */
export const DateLikeSchema = z.union([z.date(), z.iso.datetime()]);

export type DateLike = z.infer<typeof DateLikeSchema>;

/** Normalized for date math. date-fns takes both, `.getTime()` does not. */
export const toDate = (value: DateLike): Date => new Date(value);

/** "HH:mm" for today, "Yesterday HH:mm", otherwise "MMM d · HH:mm". */
export function whenOf(value: DateLike): string {
  const at = toDate(value);
  const clock = format(at, "HH:mm");
  if (isToday(at)) return clock;
  if (isYesterday(at)) return `Yesterday ${clock}`;
  return `${format(at, "MMM d")} · ${clock}`;
}

/** "now", "3m", "2h", "5d". */
export function shortAgo(value: DateLike, now = Date.now()): string {
  const seconds = Math.max(
    0,
    Math.round((now - toDate(value).getTime()) / 1000),
  );
  if (seconds < 60) return "now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}
