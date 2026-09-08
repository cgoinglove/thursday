import { tool } from "ai";
import * as z from "zod";
import { TOOL_NAMES } from "@/features/ai/tools/tool-name";

/**
 * The call lives in the page, so this tool has no server-side execute; the
 * page supplies the behaviour (use-thursday). loadTools declares it too so
 * `/api/tool-call` refuses it by name rather than as an unknown tool.
 */
export const endCallSpec = {
  name: TOOL_NAMES.end_call,
  description: `End the call.

Say goodbye first — nothing said after this reaches the user.`,
  parameters: z.object({}),
};

/** Deliberately has no `execute`. */
export const endCallTool = tool({
  description: endCallSpec.description,
  inputSchema: endCallSpec.parameters,
});

export const CALL_TOOLS = { [TOOL_NAMES.end_call]: endCallTool };
