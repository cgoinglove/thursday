import { tool } from "ai";
import * as z from "zod";
import { TOOL_NAMES } from "@/features/ai/tools/tool-name";

/** Ends the read (memory.tidy). The summary is for the log, not for anyone to read aloud. */
export const tidyDoneSpec = {
  name: TOOL_NAMES.tidy_done,
  description: "Finish. Calling this ends the read — nothing after it runs.",
  parameters: z.object({
    summary: z
      .string()
      .describe(
        "One or two lines on what changed and why, or that nothing needed to.",
      ),
  }),
};

export const tidyDoneTool = tool({
  description: tidyDoneSpec.description,
  inputSchema: tidyDoneSpec.parameters,
  execute: async ({ summary }) => ({ ok: true, summary }),
});
