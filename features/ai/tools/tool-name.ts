/**
 * Every tool name the model sees. Tools and prompts both import from here so
 * the two cannot drift. Pinned MCP tool names (`<server>__<tool>`) come from
 * the servers at run time and are not listed.
 */
export const TOOL_NAMES = {
  memory_recall: "memory_recall",
  memory_remember: "memory_remember",
  memory_forget: "memory_forget",
  memory_show: "memory_show",
  memory_conversation: "memory_conversation",

  bash: "bash",
  write_file: "write_file",

  tool_search: "tool_search",
  tool_call: "tool_call",

  load_skill: "load_skill",

  web_search: "web_search",

  delegate: "delegate",
  task: "task",
  ask_bot: "ask_bot",
  ask_thursday: "ask_thursday",
  ask_back: "ask_back",
  answer: "answer",

  end_call: "end_call",

  update_notes: "update_notes",
} as const;

/**
 * Tools on the app's built-in studio server (config STUDIO_SERVER). Reached
 * through `tool_search` / `tool_call` like any connected server's tools.
 */
export const STUDIO_TOOLS = {
  generate_image: "generate_image",
  generate_speech: "generate_speech",
  transcribe: "transcribe",
  generate_video: "generate_video",
} as const;
