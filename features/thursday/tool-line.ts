import { TOOL_NAMES } from "@/features/ai/tools/tool-name";
import type { Thread } from "@/features/bot/bot.schema";

// Human-readable activity lines for tool calls on the call screen. The model
// never reads these. Unknown names resolve to null and the screen shows the name.
const LINES: Record<string, string> = {
  [TOOL_NAMES.memory_recall]: "Checking your notes",
  [TOOL_NAMES.memory_remember]: "Noting that down",
  [TOOL_NAMES.memory_forget]: "Forgetting that",
  [TOOL_NAMES.memory_conversation]: "Reading back an earlier call",
  [TOOL_NAMES.bash]: "Doing it on this computer",
  [TOOL_NAMES.web_search]: "Searching the web",
  [TOOL_NAMES.load_skill]: "Reading how to do this",
  [TOOL_NAMES.look_at]: "Looking at the picture",
  [TOOL_NAMES.end_call]: "Ending the call",
  [TOOL_NAMES.routine]: "Checking your routines",
};

/** When a routine being made starts, as the call's arguments say it: "once at 19:10", "every 6 hours". */
function routineWhen(args: Record<string, unknown>): string | null {
  if (typeof args.at === "string" && args.at.length >= 16) {
    const [day, time] = args.at.split(" ");
    const [year, month, date] = day.split("-").map(Number);
    const on = new Date(year, month - 1, date);
    if (on.toDateString() === new Date().toDateString())
      return `once at ${time}`;
    const named = on.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
    });
    return `once, ${named} ${time}`;
  }
  if (typeof args.time === "string" && args.time)
    return `daily at ${args.time}`;
  if (typeof args.everyHours === "number")
    return `every ${args.everyHours} hours`;
  return null;
}

/**
 * How much of a fact the line carries. What is being written is the one thing
 * on this screen the user cannot check afterwards without opening the note, so
 * it is said as it happens — but the row is one line that also carries the
 * path and the tool's name, and a fact cut mid-word reads as a bug rather than
 * a quotation.
 */
const FACT_MAX = 28;

function snippet(text: string): string {
  const said = text.trim().replace(/\s+/g, " ");
  if (said.length <= FACT_MAX) return said;
  const cut = said.slice(0, FACT_MAX);
  const space = cut.lastIndexOf(" ");
  return `${(space > FACT_MAX / 2 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

/** The first fact of a `memory_remember` call, while the arguments are whole enough to read. */
function firstFact(
  args: Record<string, unknown>,
): { text: string; more: number } | null {
  if (!Array.isArray(args.facts)) return null;
  const texts = args.facts
    .map((fact) =>
      fact &&
      typeof fact === "object" &&
      typeof (fact as { text?: unknown }).text === "string"
        ? (fact as { text: string }).text.trim()
        : "",
    )
    .filter(Boolean);
  return texts.length ? { text: texts[0], more: texts.length - 1 } : null;
}

/** Lines that need the arguments; arguments may still be streaming in. */
function fromArgs(
  name: string,
  args: Record<string, unknown>,
  bot: string | null,
): string | null {
  if (name === TOOL_NAMES.memory_remember) {
    const path = typeof args.path === "string" ? args.path.trim() : "";
    const fact = firstFact(args);
    if (!path) return null;
    if (!fact) return `Noting that under ${path}`;
    const more = fact.more > 0 ? ` (+${fact.more})` : "";
    return `Noting under ${path}: ${snippet(fact.text)}${more}`;
  }
  if (name === TOOL_NAMES.thread_start) {
    const bot = typeof args.bot === "string" ? args.bot.trim() : "";
    return bot ? `Handing this to ${bot}` : "Handing this over";
  }
  if (name === TOOL_NAMES.web_search) {
    const query = typeof args.query === "string" ? args.query.trim() : "";
    return query ? `Searching · ${query}` : null;
  }
  if (name === TOOL_NAMES.routine) {
    if (args.action === "create") {
      const bot = typeof args.bot === "string" ? args.bot.trim() : "";
      const when = routineWhen(args);
      const what = [bot, when].filter(Boolean).join(", ");
      return what ? `Setting a routine · ${what}` : "Setting a routine";
    }
    if (args.action === "change") return "Changing a routine";
    if (args.action === "delete") return "Deleting a routine";
    return null;
  }
  const label = typeof args.thread === "string" ? args.thread.trim() : "";
  if (name === TOOL_NAMES.thread_tell)
    return bot ? `Telling ${bot}` : "Passing that on";
  if (name === TOOL_NAMES.thread_answer)
    return bot ? `Answering ${bot}` : "Answering that";
  if (name === TOOL_NAMES.thread_cancel)
    return label ? `Stopping ${label}` : "Stopping that";
  if (name === TOOL_NAMES.thread_seen)
    return label ? `Marking ${label} as read` : "Marking that as read";
  if (name === TOOL_NAMES.thread_show)
    return label ? `Opening ${label}` : "Opening that";
  if (name === TOOL_NAMES.thread_status)
    return label && label.toLowerCase() !== "all"
      ? `Checking on ${label}`
      : "Checking on the work";
  return null;
}

/** MCP tools are named `<server>__<tool>`; only the server name is shown. */
function fromServer(name: string): string | null {
  const at = name.indexOf("__");
  if (at <= 0) return null;
  return `Reaching ${name.slice(0, at).replace(/[-_]/g, " ")}`;
}

/** Arguments as an object, or null while they are still streaming in. */
function parseArgs(args?: string): Record<string, unknown> | null {
  if (!args) return null;
  try {
    const value: unknown = JSON.parse(args);
    if (value && typeof value === "object" && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }
  } catch {
    // Partial or non-JSON arguments: fall back to the name-only line.
  }
  return null;
}

/** The line for a tool call; `bot` is who it reaches (`toolBot`), for the lines that name them. */
export function toolLine(
  name: string,
  args?: string,
  bot: string | null = null,
): string | null {
  if (name === TOOL_NAMES.tool_search || name === TOOL_NAMES.tool_call) {
    return "Reaching a connected service";
  }
  const parsed = parseArgs(args);
  return (
    (parsed && fromArgs(name, parsed, bot)) ?? LINES[name] ?? fromServer(name)
  );
}

/** The call's tools that act on one thread the model names by its label or id. */
const ON_A_THREAD = new Set<string>([
  TOOL_NAMES.thread_tell,
  TOOL_NAMES.thread_answer,
  TOOL_NAMES.thread_status,
  TOOL_NAMES.thread_show,
  TOOL_NAMES.thread_cancel,
  TOOL_NAMES.thread_seen,
]);

/**
 * The bot a call's tool reaches, so its row wears that bot's face rather than a glyph —
 * who work went to is a face everywhere else in the app. The one work is handed to, else
 * the bot of the thread the tool names, found as the server finds a thread (thread.query
 * resolveThread): its id, else its label. An answer goes to the bot that asked; "all", and
 * a thread the page does not hold, reach nobody in particular.
 */
export function toolBot(
  name: string,
  args?: string,
  threads?: Thread[],
): string | null {
  const parsed = parseArgs(args);
  if (!parsed) return null;
  if (name === TOOL_NAMES.thread_start)
    return typeof parsed.bot === "string" && parsed.bot.trim()
      ? parsed.bot.trim()
      : null;
  if (!ON_A_THREAD.has(name) || !threads) return null;
  const ref = typeof parsed.thread === "string" ? parsed.thread.trim() : "";
  if (!ref || ref.toLowerCase() === "all") return null;
  const lower = ref.toLowerCase();
  const thread =
    threads.find((one) => one.id === ref) ??
    threads.find((one) => one.label.toLowerCase() === lower);
  if (!thread) return null;
  return name === TOOL_NAMES.thread_answer
    ? (thread.room.questions[0]?.bot ?? thread.bot)
    : thread.bot;
}

/**
 * The label a thread was started under, or null for any other turn. It is
 * how a job is found again from the line that opened it — in her prompt and in
 * the call log alike.
 */
export function startedLabel(
  tool: string | null | undefined,
  text: string,
): string | null {
  if (tool !== TOOL_NAMES.thread_start) return null;
  try {
    const said = JSON.parse(text) as { label?: unknown };
    return typeof said.label === "string" ? said.label : null;
  } catch {
    return null;
  }
}

/** A page a call's web search read (lib/live LiveSource), as its tool turn stores it. */
export type SearchedSource = { url: string; title?: string };

/**
 * What a web search turn looked for and read, or null for any other turn. The call's
 * search is the backend's own hosted tool: its turn is stored by the page as
 * `{query, sources}`, and the call log and the next call's prompt read it back here.
 */
export function searchOf(
  tool: string | null | undefined,
  text: string,
): { query: string | null; sources: SearchedSource[] } | null {
  if (tool !== TOOL_NAMES.web_search) return null;
  try {
    const said = JSON.parse(text) as { query?: unknown; sources?: unknown };
    const sources = Array.isArray(said.sources)
      ? said.sources.flatMap((source) =>
          source &&
          typeof source === "object" &&
          typeof (source as SearchedSource).url === "string"
            ? [source as SearchedSource]
            : [],
        )
      : [];
    return {
      query: typeof said.query === "string" ? said.query : null,
      sources,
    };
  } catch {
    return null;
  }
}

/** What a `web_search` call asked for, from its arguments. */
export function searchQueryOf(args: string): string | null {
  const query = parseArgs(args)?.query;
  return typeof query === "string" && query.trim() ? query.trim() : null;
}

/**
 * The pages the call's Exa search came back with (ai/tools/search.tool createCallSearchTool
 * answers `{results, sources}`), or none for an answer of any other shape — a failure line,
 * a result cut short.
 */
export function searchSourcesOf(output: string): SearchedSource[] {
  const said = parseArgs(output);
  return said
    ? (searchOf(TOOL_NAMES.web_search, JSON.stringify(said))?.sources ?? [])
    : [];
}
