import { resolveDefaultModel } from "@/features/ai/model";
import type { AutomaticModel } from "@/features/ai/model.schema";
import { serverRoute } from "@/lib/protocol/server-route";
import { errorToString } from "@/lib/utils";

/**
 * What a bot with no model picked runs on now, by the same resolution its run uses, or why
 * nothing can. Settings › Models names it beside "auto": the first row of the list it drew
 * before was the smallest model, not the one that ran.
 */
export const GET = serverRoute(async (): Promise<AutomaticModel> => {
  try {
    return {
      ref: await resolveDefaultModel(undefined, { quiet: true }),
      problem: null,
    };
  } catch (cause) {
    return { ref: null, problem: errorToString(cause) };
  }
});
