"use server";

import { STUDIO_SERVER } from "@/config";
import {
  deleteServer,
  findServerDetail,
  upsertServer,
} from "@/features/connectors/mcp.query";
import { MCPServerFormSchema } from "@/features/connectors/mcp.schema";
import { serverAction } from "@/lib/protocol/server-action";
import { publicError } from "@/lib/public-error";
import { errorToString } from "@/lib/utils";
import { McpAuthRequiredError, mcpManager } from "./mcp.manager";

/** What register/refresh reports to the UI. A failed connect is a state to show, not an exception. */
export type ConnectSummary = {
  name: string;
  status: "connected" | "auth_required" | "error";
  /** Set when the server wants the user to sign in first. */
  authorizationUrl?: string;
  toolCount: number;
  error?: string;
};

/**
 * Registers (or re-registers) a server and connects. The row is written before
 * connecting because the OAuth callback finds its server by the stored state.
 * A brand-new row whose connect fails outright is rolled back.
 */
export const registerServerAction = serverAction(async (input: unknown) => {
  const parsed = MCPServerFormSchema.parse(input);
  // The built-in studio server is listed under this name; a clash would make tool_call ambiguous
  if (parsed.name === STUDIO_SERVER) {
    publicError(`"${STUDIO_SERVER}" is the app's own — pick another name`);
  }
  const existed = Boolean(await findServerDetail(parsed.name));

  await upsertServer(parsed);
  const summary = await connectSummary(parsed.name);

  if (summary.status === "error" && !existed) await deleteServer(parsed.name);
  return summary;
});

/** Drop the session and reconnect. */
export const refreshServerAction = serverAction(async (name: string) => {
  await mcpManager.disconnect(name);
  return connectSummary(name);
});

export const deleteServerAction = serverAction(async (name: string) => {
  // Close a live session first so nothing keeps talking for a deleted row
  await mcpManager.disconnect(name);
  if (!(await deleteServer(name))) publicError("Server not found");
});

async function connectSummary(name: string): Promise<ConnectSummary> {
  try {
    const outcome = await mcpManager.connect(name);
    return outcome.status === "auth_required"
      ? {
          name,
          status: "auth_required",
          authorizationUrl: outcome.authorizationUrl,
          toolCount: 0,
        }
      : { name, status: "connected", toolCount: outcome.tools.length };
  } catch (cause) {
    // Return the reason rather than throwing, so the screen shows it instead of a masked error
    return {
      name,
      status: "error",
      toolCount: 0,
      error: errorToString(cause),
    };
  }
}

/** Runs one tool with raw JSON args (the detail screen's test bench). */
export const callToolAction = serverAction(
  async (server: string, tool: string, args?: Record<string, unknown>) => {
    try {
      return await mcpManager.callTool(server, tool, args);
    } catch (cause) {
      if (cause instanceof McpAuthRequiredError) {
        publicError("Authorization required — reconnect this server first");
      }
      // The bench shows the server's answer as is, refusals included; a masked
      // error would say nothing about arguments this server would not take.
      publicError(errorToString(cause));
    }
  },
);
