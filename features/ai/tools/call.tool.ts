import { tool } from "ai";
import * as z from "zod";
import { TOOL_NAMES } from "@/features/ai/tools/tool-name";
import {
  FACE_WORD_MARKS,
  FACE_WORD_MAX,
} from "@/features/thursday/ascii.const";

/**
 * The call lives in the page, so these tools have no server-side execute; the
 * page supplies the behaviour (use-thursday). loadTools declares them too so
 * `/api/tool-call` refuses them by name rather than as unknown tools.
 */
const endCallSpec = {
  name: TOOL_NAMES.end_call,
  description: `End the call.

The line stays open until this runs, and drops once the goodbye being said is over.`,
  parameters: z.object({}),
};

/** Deliberately has no `execute`. */
const endCallTool = tool({
  description: endCallSpec.description,
  inputSchema: endCallSpec.parameters,
});

const emoteSpec = {
  name: TOOL_NAMES.emote,
  description: "Show a short word on your face for a few seconds.",
  parameters: z.object({
    text: z
      .string()
      .describe(
        `Up to ${FACE_WORD_MAX} characters: A-Z, 0-9, space and ${FACE_WORD_MARKS.join(" ")}.`,
      ),
  }),
};

/** Deliberately has no `execute`. */
const emoteTool = tool({
  description: emoteSpec.description,
  inputSchema: emoteSpec.parameters,
});

/** The tools that act on the call itself. `emote` only when the face can draw a word (the ascii orb). */
export function callTools(faceWords: boolean) {
  return {
    [TOOL_NAMES.end_call]: endCallTool,
    ...(faceWords ? { [TOOL_NAMES.emote]: emoteTool } : {}),
  };
}
