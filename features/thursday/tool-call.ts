"use client";

import { queryKey } from "@/app/api/query-key";
import { type Result, unwrapResult } from "@/lib/protocol/result";
import type { RealtimeToolCall } from "@/lib/realtime/realtime.session";
import { errorToString } from "@/lib/utils";

/**
 * Runs a tool the realtime model called on the server and returns the string
 * for the model. Never throws: every failure comes back as one readable line.
 */
export async function runRemoteTool(
  callId: string,
  call: RealtimeToolCall,
  /** Aborted when the call ends, so a running tool stops with it (route). */
  signal?: AbortSignal,
): Promise<string> {
  try {
    const response = await fetch(queryKey.toolCall, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        toolCallId: call.id,
        callId,
        name: call.name,
        // Validation happens where the tool runs.
        input: call.arguments ? JSON.parse(call.arguments) : {},
      }),
      signal,
    });
    const { output } = unwrapResult(
      (await response.json()) as Result<{ output: unknown }>,
    );
    return typeof output === "string" ? output : JSON.stringify(output ?? null);
  } catch (cause) {
    return `Error: ${errorToString(cause)}`;
  }
}
