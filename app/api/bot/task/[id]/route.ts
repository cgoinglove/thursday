import { readToolResult } from "@/features/bot/task.query";
import { type RouteContext, serverRoute } from "@/lib/protocol/server-route";
import { publicError } from "@/lib/public-error";

/**
 * Parts of one task that the list omits. `?call=<toolCallId>` returns the full
 * ResultPart[] of one tool call; the list carries only a few lines of it.
 */
export const GET = serverRoute(
  async (request, { params }: RouteContext<{ id: string }>) => {
    const { id } = await params;
    const query = new URL(request.url).searchParams;

    const call = query.get("call");
    if (call) {
      const parts = await readToolResult(id, call);
      if (!parts) publicError("No such tool result");
      return parts;
    }

    publicError("Which part — `call`?");
  },
);
