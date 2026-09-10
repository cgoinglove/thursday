import { TOOL_NAMES } from "@/features/ai/tools/tool-name";

// Human-readable activity lines for tool calls on the call screen. The model
// never reads these. Unknown names resolve to null and the screen shows the name.
const LINES: Record<string, string> = {
  [TOOL_NAMES.memory_recall]: "Checking your notes",
  [TOOL_NAMES.memory_remember]: "Noting that down",
  [TOOL_NAMES.memory_forget]: "Forgetting that",
  [TOOL_NAMES.memory_show]: "Putting your notes on screen",
  [TOOL_NAMES.bash]: "Doing it on this computer",
  [TOOL_NAMES.web_search]: "Searching the web",
  [TOOL_NAMES.load_skill]: "Reading how to do this",
  [TOOL_NAMES.end_call]: "Ending the call",
};

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
function fromArgs(name: string, args: Record<string, unknown>): string | null {
  if (name === TOOL_NAMES.memory_remember) {
    const path = typeof args.path === "string" ? args.path.trim() : "";
    const fact = firstFact(args);
    if (!path) return null;
    if (!fact) return `Noting that under ${path}`;
    const more = fact.more > 0 ? ` (+${fact.more})` : "";
    return `Noting under ${path}: ${snippet(fact.text)}${more}`;
  }
  if (name === TOOL_NAMES.delegate) {
    const bot = typeof args.bot === "string" ? args.bot.trim() : "";
    return bot ? `Handing this to ${bot}` : "Handing this over";
  }
  if (name === TOOL_NAMES.task) {
    const label = typeof args.task === "string" ? args.task.trim() : "";
    if (args.action === "answer") return "Passing that back";
    if (args.action === "cancel") return "Stopping that";
    return label ? `Checking on ${label}` : "Checking the jobs";
  }
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

export function toolLine(name: string, args?: string): string | null {
  if (name === TOOL_NAMES.tool_search || name === TOOL_NAMES.tool_call) {
    return "Reaching a connected service";
  }
  const parsed = parseArgs(args);
  return (parsed && fromArgs(name, parsed)) ?? LINES[name] ?? fromServer(name);
}

/**
 * The bot a call hands work to, when it names one. The row draws that bot's own
 * face instead of a glyph: who it went to is a face everywhere else in the app.
 */
export function toolBot(name: string, args?: string): string | null {
  if (name !== TOOL_NAMES.delegate && name !== TOOL_NAMES.ask_bot) return null;
  const bot = parseArgs(args)?.bot;
  return typeof bot === "string" && bot.trim() ? bot.trim() : null;
}

/**
 * The label a `delegate` call was made under, or null for any other turn. It is
 * how a job is found again from the line that opened it — in her prompt and in
 * the call log alike.
 */
export function delegatedLabel(
  tool: string | null | undefined,
  text: string,
): string | null {
  if (tool !== TOOL_NAMES.delegate) return null;
  try {
    const said = JSON.parse(text) as { label?: unknown };
    return typeof said.label === "string" ? said.label : null;
  } catch {
    return null;
  }
}
