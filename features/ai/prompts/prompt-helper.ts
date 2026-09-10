import { format, formatDistanceToNowStrict } from "date-fns";
import { MEMORY_LIMITS, PROMPT_BUDGET, PROMPT_LINE } from "@/config";
import { TOOL_NAMES } from "@/features/ai/tools/tool-name";
import type { McpToolRef } from "@/features/connectors/mcp.schema";
import type {
  MemoryAlwaysLoaded,
  MemoryIndexEntry,
} from "@/features/memory/memory.schema";
import type { SkillMetadata } from "@/features/skills/skills.discover";
import { delegatedLabel } from "@/features/thursday/tool-line";
import { toDate } from "@/lib/date-like";
import { logger } from "@/lib/logger";
import { estimateTokens, sectionTokens } from "@/lib/tokens";
import { clip } from "@/lib/utils";

/**
 * Row-to-line formatters shared by thursday.prompt and bot.prompt, plus the tidying check.
 * Nothing here wraps a sentence; headings and paragraphs live in the prompt that says them.
 */

/** What one assembled prompt hands back to the run that asked for it. */
export type LoadedPrompt = {
  text: string;
  /** Who this run can reach with `ask_bot`. When empty the runner does not attach the tool (bot.run). */
  peers: string[];
  /** System item injected the moment the line opens so the assistant speaks first (thursday.prompt opening). Always null for a bot. */
  opening: string | null;
};

/**
 * What one assembled prompt costs, said where it is assembled. The debug line is
 * the whole breakdown; past PROMPT_BUDGET it is a warning naming the chapter
 * carrying it, and that one is always a listing the user can act on — nothing
 * else in the app would ever say a prompt had grown.
 */
export function logPromptSize(kind: string, text: string): void {
  const parts = sectionTokens(text);
  const total = parts.reduce((sum, part) => sum + part.tokens, 0);
  logger.debug(
    `${kind} prompt ${total} tokens — ${parts
      .map((part) => `${part.name} ${part.tokens}`)
      .join(", ")}`,
  );
  const biggest = parts[0];
  if (total > PROMPT_BUDGET && biggest) {
    logger.warn(
      `${kind} prompt is ${total} tokens, over ${PROMPT_BUDGET}: ${biggest.name} carries ${biggest.tokens} of it. Every call and every job pays this.`,
    );
  }
}

/** `2026-09-02 (Wed) 15:41 Asia/Seoul` */
export const clockNow = (now = new Date()) =>
  `${format(now, "yyyy-MM-dd (EEE) HH:mm")} ${
    Intl.DateTimeFormat().resolvedOptions().timeZone
  }`;

/** `**Now**: 2026-09-02 (Wed) 15:41 Asia/Seoul` */
export const nowLine = (now = new Date()) => `**Now**: ${clockNow(now)}`;

/**
 * When a call happened, the one way every prompt and tool says it: local, the
 * same shape as `Now` (clockNow), with how long ago. A UTC stamp beside a local
 * `Now` put two clocks nine hours apart in one prompt, and a call from last
 * night read as one from this afternoon.
 */
export const callStamp = (at: Date): string =>
  `${format(at, "yyyy-MM-dd (EEE) HH:mm")} (${formatDistanceToNowStrict(at, { addSuffix: true })})`;

/** When a fact was said, for the fact itself: the date and time without the distance. */
export const saidStamp = (at: Date): string =>
  format(at, "yyyy-MM-dd (EEE) HH:mm");

/**
 * A call as a conversation: who said what, and which tool was used — never its
 * arguments or its result. What was asked for and what was said back is the
 * conversation; the arguments are already in memory and the results are not
 * what anyone said.
 */
export const conversationLines = (
  turns: { role: string; tool: string | null; text: string }[],
): string =>
  turns
    .map((turn) =>
      turn.role === "tool"
        ? `you → ${turn.tool ?? "tool"}`
        : `${turn.role === "user" ? "user" : "you"}: ${turn.text}`,
    )
    .join("\n");

/** `4mo`, `12d`: short enough to read aloud. */
function sinceLast(at: MemoryIndexEntry["lastSeenAt"]): string {
  const days = Math.floor((Date.now() - toDate(at).getTime()) / 86_400_000);
  if (days >= 365) return `${Math.floor(days / 365)}y`;
  if (days >= 30) return `${Math.floor(days / 30)}mo`;
  return `${Math.max(days, 0)}d`;
}

/** `- people/yuri — partner (3) "yuri" "wife" · 12d` */
export function noteLines(index: MemoryIndexEntry[], age = false): string {
  if (!index.length) return "(nothing saved yet)";
  return index
    .map((note) => {
      const aliases = note.aliases?.length
        ? ` ${note.aliases.map((alias) => `"${alias}"`).join(" ")}`
        : "";
      const since = age ? ` · ${sinceLast(note.lastSeenAt)}` : "";
      return `- ${note.path} — ${note.description?.trim()} (${note.factCount})${aliases}${since}`;
    })
    .join("\n");
}

/** `- Their name is Yuri · profile #12` */
export const carriedLines = (loaded: MemoryAlwaysLoaded[]): string =>
  loaded.map((fact) => `- ${fact.text} · ${fact.path} #${fact.id}`).join("\n");

/**
 * Whether it is time to tidy, and why: too much held in all (the coldest notes
 * are what to drop), or one note too long to hold in one piece (it names itself).
 * Both counted in facts, the unit the user sees on their own screen and the one
 * every write hands back — a token estimate is nobody's unit and cannot be acted on.
 */
export const tidying = (index: MemoryIndexEntry[]) => ({
  crowded:
    index.reduce((sum, note) => sum + note.factCount, 0) > MEMORY_LIMITS.facts,
  heavy: index.filter((note) => note.factCount > MEMORY_LIMITS.factsPerNote),
});

/** A bot gets the whole description; `short` gives the voice prompt the first sentence only. */
export const skillLines = (
  skills: SkillMetadata[],
  options: { short?: boolean } = {},
): string =>
  skills
    .map(
      (skill) =>
        `- **${skill.name}**: ${options.short ? headline(skill.description) : skill.description}`,
    )
    .join("\n");

function headline(description: string): string {
  const max = PROMPT_LINE.skill;
  const first = description
    .trim()
    .split(/(?<=[.。])\s|\n/)[0]
    .trim();
  return first.length > max ? `${first.slice(0, max).trim()}…` : first;
}

/** `- **slack**: send_message, list_channels` — a bot's list: every name, no schemas. */
export function mcpToolLines(tools: McpToolRef[]): string {
  const byServer = new Map<string, string[]>();
  for (const entry of tools) {
    const names = byServer.get(entry.server);
    if (names) names.push(entry.name);
    else byServer.set(entry.server, [entry.name]);
  }
  return [...byServer]
    .map(([server, names]) => `- **${server}**: ${names.join(", ")}`)
    .join("\n");
}

/** `- **github**: 2 tools` — the voice prompt's list: what exists, not what to call. */
export function mcpServerLines(tools: McpToolRef[]): string {
  const byServer = new Map<string, number>();
  for (const entry of tools) {
    byServer.set(entry.server, (byServer.get(entry.server) ?? 0) + 1);
  }
  return [...byServer]
    .map(
      ([server, count]) =>
        `- **${server}**: ${count} tool${count === 1 ? "" : "s"}`,
    )
    .join("\n");
}

export type RecentCall = {
  startedAt: Date;
  turns: {
    role: "user" | "assistant" | "tool";
    tool?: string | null;
    text: string;
  }[];
  /** Jobs this call opened, folded into the `delegate` line that opened them. */
  jobs?: {
    id: string;
    label: string;
    status: string;
    outcome: string | null;
  }[];
};

/**
 * One turn as the transcript carries it. A `delegate` line takes what became of
 * the job: the handle to pick it back up, and how it ended — arguments alone say
 * a job was handed over and nothing about whether it is still worth continuing.
 */
function turnLine(turn: RecentCall["turns"][number], call: RecentCall): string {
  if (turn.role !== "tool")
    return `${turn.role === "user" ? "user" : "you"}: ${turn.text}`;

  const args = `you → ${turn.tool ?? "tool"} ${clip(turn.text, PROMPT_LINE.toolArgs)}`;
  if (turn.tool !== TOOL_NAMES.delegate) return args;

  const label = delegatedLabel(turn.tool, turn.text);
  const job = label ? call.jobs?.find((one) => one.label === label) : undefined;
  if (!job) return args;

  const said = job.outcome
    ? `: ${clip(job.outcome, PROMPT_LINE.jobOutcome)}`
    : "";
  return `you → ${turn.tool} "${job.label}" (${job.id}) — ${job.status}${said}`;
}

/** The last calls as stored, newest last, cut to a token budget. A tool turn carries the call, not the result. */
export function recentCallLines(calls: RecentCall[], budget: number): string {
  // Newest line backwards until the budget is spent, then put it back in order.
  // Measured on the rendered line: a job's answer is on it and its arguments are not
  const kept: { call: RecentCall; line: string }[] = [];
  let spent = 0;
  outer: for (let c = calls.length - 1; c >= 0; c--) {
    const call = calls[c];
    for (let t = call.turns.length - 1; t >= 0; t--) {
      const line = turnLine(call.turns[t], call);
      const cost = estimateTokens(line) + 3;
      if (spent + cost > budget && kept.length) break outer;
      spent += cost;
      kept.push({ call, line });
    }
  }
  kept.reverse();

  const lines: string[] = [];
  let open: RecentCall | null = null;
  for (const { call, line } of kept) {
    if (call !== open) {
      open = call;
      lines.push(`### ${callStamp(call.startedAt)}`);
    }
    lines.push(line);
  }
  return lines.join("\n");
}
