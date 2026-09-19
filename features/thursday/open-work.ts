import { CALL_RELAY } from "@/config";
import { isAppStop, type Thread } from "@/features/bot/bot.schema";
import { toDate } from "@/lib/date-like";
import type { ActivityLine } from "./use-thursday";

/**
 * Background work that waits on the user, as a call is told about it: the one list both
 * kinds of call read — a spoken call puts it to her voice when the line is quiet
 * (use-thursday), a call in writing puts it to her between turns (use-text-call). It reads
 * the inbox and words each item; the one thing it holds is what has been told already, since
 * that is true of the page rather than of either call.
 */

/**
 * Open work put to her while this page has been open, by item key: each goes in once,
 * whichever kind of call carried it. A key holds its job's last change, so a job that asks
 * or ends again is new work. A call takes a key back out when what it put in never reached
 * the user — her voice never carried it, her written answer failed.
 */
export const toldWork = new Set<string>();

/** One piece of background work waiting on the user, as the relay clock puts it to her. */
export type OpenWork = {
  key: string;
  /** What it is, so one append holds one kind. */
  kind: "question" | "ending" | "progress";
  /** The relay text. */
  line: string;
  /** Relay rows it covers, accepted once it lands. */
  relayIds: number[];
  /** The same item on the activity line, so the user sees where her words came from. */
  show: ActivityLine;
};

const OPEN_RANK = {
  question: 0,
  stopped: 1,
  done: 2,
  progress: 3,
} as const;

/**
 * What of a bot's message goes into the call. A message is written for the screen
 * — captions, sources, file lists — and she reads an update aloud: past
 * CALL_RELAY.chars it is cut at a paragraph or a sentence, and the cut says where
 * the rest is, as a fact.
 */
function spoken(text: string): string {
  const whole = text.trim();
  if (whole.length <= CALL_RELAY.chars) return whole;
  const head = whole.slice(0, CALL_RELAY.chars);
  const at = Math.max(
    head.lastIndexOf("\n\n"),
    head.lastIndexOf(". "),
    head.lastIndexOf(".\n"),
    head.lastIndexOf("。"),
  );
  const kept = (
    at > CALL_RELAY.chars / 3 ? head.slice(0, at + 1) : head
  ).trim();
  return `${kept}\n[The message goes on; the rest is in its thread on screen.]`;
}

/**
 * Everything in the inbox still waiting on the user, most pressing first:
 * questions, then jobs stopped or finished and not yet seen, then
 * progress from jobs still running. Sent as commentary; the bracket carries
 * facts only — who, which thread, where an answer goes — because the backend
 * reads relays too and routes answers by them.
 */
export function openWork(threads: Thread[]): OpenWork[] {
  const items: (OpenWork & { rank: number })[] = [];
  for (const thread of threads) {
    const { relays, questions } = thread.room;
    const changed = toDate(thread.updatedAt).getTime();
    const bracket = (from: string, kind: string) =>
      `[${from} → Thursday, thread "${thread.label}" (${thread.id}), ${kind}.]`;
    const show = (bot: string, line: string): ActivityLine => ({
      kind: "relay",
      name: thread.label,
      line,
      done: true,
      bot,
    });

    for (const question of questions) {
      const options = question.options?.length
        ? ` Options: ${question.options.join(" / ")}.`
        : "";
      items.push({
        rank: OPEN_RANK.question,
        key: `question:${question.id}`,
        kind: "question",
        line: `${bracket(question.bot, "question")}\n${spoken(question.text)}${options}`,
        relayIds: relays
          .filter((relay) => relay.messageId === question.id)
          .map((relay) => relay.id),
        show: show(question.bot, `${question.bot}: question`),
      });
    }

    // Relay rows that belong to no open question
    const loose = relays.filter(
      (relay) => !questions.some((question) => question.id === relay.messageId),
    );
    // A cancel is the user's own and already seen; nothing about it is news
    const ended = thread.status === "done";
    // A stop the app picks back up by itself is not news: it runs again in a moment
    const stopped =
      thread.status === "waiting" && isAppStop(thread.ask) && !thread.ask?.auto;

    if (ended || stopped) {
      if (thread.seen) continue;
      const kind = stopped ? "stopped" : "done";
      const said =
        kind === "stopped"
          ? `It stopped before finishing. Where it got to: ${spoken(thread.ask?.question ?? thread.outcome ?? "")}`
          : `Done. Its answer: ${spoken(thread.outcome ?? "")}`;
      items.push({
        rank: OPEN_RANK[kind],
        key: `${kind}:${thread.id}@${changed}`,
        kind: "ending",
        line: `${bracket(thread.bot, kind)}\n${said}`,
        // Its ending says what its progress messages said
        relayIds: loose.map((relay) => relay.id),
        show: show(
          thread.bot,
          kind === "stopped"
            ? `${thread.bot} stopped`
            : `Answer from ${thread.bot}`,
        ),
      });
      continue;
    }

    for (const relay of loose) {
      items.push({
        rank: OPEN_RANK.progress,
        key: `progress:${relay.id}`,
        kind: "progress",
        line: `${bracket(relay.bot, relay.kind)}\n${spoken(relay.text)}`,
        relayIds: [relay.id],
        show: show(relay.bot, `${relay.bot}: ${relay.kind}`),
      });
    }
  }
  return items.sort((a, b) => a.rank - b.rank);
}
