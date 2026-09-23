import { format, formatDistanceToNowStrict } from "date-fns";
import {
  MEMORY_LIMITS,
  PROMPT_BUDGET,
  PROMPT_LINE,
  STUDIO_SERVER,
} from "@/config";
import { STUDIO_TOOLS, TOOL_NAMES } from "@/features/ai/tools/tool-name";
import type { BotWorkLine } from "@/features/bot/bot.schema";
import type { McpToolRef } from "@/features/connectors/mcp.schema";
import type { MemoryIndexEntry } from "@/features/memory/memory.schema";
import type { SkillMetadata } from "@/features/skills/skills.discover";
import { searchOf, startedLabel } from "@/features/thursday/tool-line";
import { toDate } from "@/lib/date-like";
import { logger } from "@/lib/logger";
import { estimateTokens, sectionTokens } from "@/lib/tokens";
import { clip } from "@/lib/utils";

/**
 * Row-to-line formatters shared by the call prompts (live, thursday) and bot.prompt, plus the tidying check.
 * Nothing here wraps a sentence; headings and paragraphs live in the prompt that says them. The
 * exceptions are what both call prompts say alike: `thursdayIdentity`, the words they open
 * with, and `styleLines`, the user's own words on how she talks.
 */

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

/** `2026-09-02 (Wed) 15:41 Europe/Lisbon` */
export const clockNow = (now = new Date()) =>
  `${format(now, "yyyy-MM-dd (EEE) HH:mm")} ${
    Intl.DateTimeFormat().resolvedOptions().timeZone
  }`;

/** `**Now**: 2026-09-02 (Wed) 15:41 Europe/Lisbon` */
/**
 * One of a bot's other threads, up to its words: whose it is and where it stands. The
 * listing in its prompt and the tool that opens one whole say it the same way.
 */
export function botWorkHead(row: BotWorkLine, self: string): string {
  const since = formatDistanceToNowStrict(row.updatedAt, { addSuffix: true });
  const state =
    row.status === "running"
      ? `running, last moved ${since}`
      : row.asking
        ? `waiting on the user's answer since ${since}`
        : row.status === "waiting"
          ? `stopped ${since}, not finished`
          : `${row.status === "done" ? "ended" : "stopped by the user"} ${format(row.updatedAt, "yyyy-MM-dd")}`;
  return `"${row.label}" — ${row.owner === self ? "yours" : `${row.owner}'s`} — ${state}`;
}

export const nowLine = (now = new Date()) => `**Now**: ${clockNow(now)}`;

/**
 * Who Thursday is, in the words both call prompts open with. The Live voice and its Responses
 * backend are one assistant, so neither is told it is part of something else, and one sentence
 * here keeps the two from drifting. A friend first, because why they call is what the identity
 * is for and an assistant on its own opened every call on work; the work is held where it is
 * done, by the persona's shared paragraph and the tools. `Named after`, not `modeled on`: a
 * lineage makes "Thursday" a name rather than a weekday in whatever language she speaks, while
 * a character she is told she *is* becomes one she defends. No manner — quick, warm, dry — is
 * stated: how she speaks is the persona's and the Live model's own.
 */
export const thursdayIdentity = (now = new Date()) =>
  `You are Thursday, this user's own: their friend first, and their assistant second — someone they call because they want to talk to you, who can also get whatever they need done in the background. Named after Friday, the AI in *Iron Man*: a name, not a day of the week. ${nowLine(now)}

What they tell you is kept, so you know them better over time.`;

/**
 * Settings › Thursday › Style, in the user's own words, on top of the picked character
 * rather than in place of it. Read by whichever of the two is the one talking: the voice
 * on a spoken call, the backend on a call in writing (live.prompt, thursday.prompt).
 */
export const styleLines = (stylePrompt?: string | null) =>
  stylePrompt?.trim()
    ? `## Who they want you to be

Their own words, on top of the character above: how you talk to them, how much to say, what to leave out. Where they differ from anything above, theirs wins.

${stylePrompt.trim()}`
    : "";

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

/** `4mo`, `12d`: short enough to read aloud. */
function sinceLast(at: MemoryIndexEntry["lastSeenAt"]): string {
  const days = Math.floor((Date.now() - toDate(at).getTime()) / 86_400_000);
  if (days >= 365) return `${Math.floor(days / 365)}y`;
  if (days >= 30) return `${Math.floor(days / 30)}mo`;
  return `${Math.max(days, 0)}d`;
}

/** `- people/partner — partner, their first name (3) · 12d` */
export function noteLines(index: MemoryIndexEntry[], age = false): string {
  if (!index.length) return "(nothing saved yet)";
  return index
    .map((note) => {
      const since = age ? ` · ${sinceLast(note.lastSeenAt)}` : "";
      return `- ${note.path} — ${note.description?.trim()} (${note.factCount})${since}`;
    })
    .join("\n");
}

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

/** A bot gets the whole description; `short` gives the call the first sentence only. */
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

/** The studio's tools in plain words: their names are a bot's to call, not a list for the call to read. */
const STUDIO_WORDS: Record<string, string> = {
  [STUDIO_TOOLS.generate_image]: "images",
  [STUDIO_TOOLS.generate_speech]: "speech",
  [STUDIO_TOOLS.transcribe]: "transcription",
  [STUDIO_TOOLS.generate_video]: "video",
};

/**
 * `browser, computer, github, images` — what bots can reach for, by name only: skills and
 * connected servers in one line, with nothing saying which is which. The call needs the range,
 * not how each one is used; a bot's own prompt carries that.
 */
export function reachNames(
  skills: SkillMetadata[],
  tools: McpToolRef[],
): string {
  const connected = tools.map((tool) =>
    tool.server === STUDIO_SERVER
      ? (STUDIO_WORDS[tool.name] ?? tool.name)
      : tool.server,
  );
  return [
    ...new Set([...skills.map((skill) => skill.name), ...connected]),
  ].join(", ");
}

type RecentCall = {
  startedAt: Date;
  turns: {
    role: "user" | "assistant" | "tool";
    tool?: string | null;
    text: string;
  }[];
  /** Threads this call started, folded into the line that started them. */
  jobs?: {
    id: string;
    label: string;
    status: string;
    outcome: string | null;
  }[];
};

/**
 * One turn as the transcript carries it. A line that started a thread takes what became of
 * the job: the handle to pick it back up, and how it ended — arguments alone say
 * a job was handed over and nothing about whether it is still worth continuing.
 */
function turnLine(turn: RecentCall["turns"][number], call: RecentCall): string {
  if (turn.role !== "tool")
    return `${turn.role === "user" ? "user" : "you"}: ${turn.text}`;

  // A web search is stored as what it looked for and read: the query and the sites,
  // never the JSON it is kept in, which the argument clip would cut to a brace
  const searched = searchOf(turn.tool, turn.text);
  if (searched) {
    const sites = [
      ...new Set(
        searched.sources.flatMap((source) => {
          try {
            return [new URL(source.url).hostname.replace(/^www\./, "")];
          } catch {
            return [];
          }
        }),
      ),
    ];
    return `you → ${turn.tool} "${clip(searched.query ?? "", PROMPT_LINE.toolArgs)}"${sites.length ? ` — ${sites.join(", ")}` : ""}`;
  }

  const args = `you → ${turn.tool ?? "tool"} ${clip(turn.text, PROMPT_LINE.toolArgs)}`;
  if (turn.tool !== TOOL_NAMES.thread_start) return args;

  const label = startedLabel(turn.tool, turn.text);
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
