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

/** Lines that need the arguments; arguments may still be streaming in. */
function fromArgs(name: string, args: Record<string, unknown>): string | null {
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

export function toolLine(name: string, args?: string): string | null {
  if (name === TOOL_NAMES.tool_search || name === TOOL_NAMES.tool_call) {
    return "Reaching a connected service";
  }
  let parsed: Record<string, unknown> | null = null;
  if (args) {
    try {
      const value: unknown = JSON.parse(args);
      if (value && typeof value === "object" && !Array.isArray(value)) {
        parsed = value as Record<string, unknown>;
      }
    } catch {
      // Partial or non-JSON arguments: fall back to the name-only line.
    }
  }
  return (parsed && fromArgs(name, parsed)) ?? LINES[name] ?? fromServer(name);
}
