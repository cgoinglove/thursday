import z from "zod";
import { STUDIO_SERVER } from "@/config";
import {
  McpAuthRequiredError,
  mcpManager,
} from "@/features/connectors/mcp.manager";
import {
  findToolSchemas,
  listServerNames,
  listToolNames,
} from "@/features/connectors/mcp.query";
import type {
  McpCallOutcome,
  McpToolRef,
} from "@/features/connectors/mcp.schema";
import type { Sandbox } from "@/lib/sandbox";
import { errorToString } from "@/lib/utils";
import { loadStudio } from "./studio.tool";

/**
 * Everything behind `tool_search` and `tool_call`, from two sources in one shape: the MCP
 * servers the user connected (mcp.manager) and the studio the app ships (studio.tool). Another
 * built-in source is a branch in each of the four functions here. The studio lists first.
 */

/** `- server: tool, tool` in the prompt, in this order. */
export async function listConnectedToolNames(
  server?: string,
): Promise<McpToolRef[]> {
  const [studio, mcp] = await Promise.all([
    !server || server === STUDIO_SERVER ? loadStudio() : [],
    server === STUDIO_SERVER ? [] : listToolNames(server),
  ]);
  return [
    ...studio.map((tool) => ({ server: STUDIO_SERVER, name: tool.name })),
    ...mcp,
  ];
}

/** Whether the studio has anything at all — the prompts say what it is only then. */
export const listConnectedServerNames = async (): Promise<string[]> => {
  const [studio, mcp] = await Promise.all([loadStudio(), listServerNames()]);
  return [
    ...(studio.length ? [STUDIO_SERVER] : []),
    ...mcp.map((row) => row.name),
  ];
};

export type ConnectedToolSchema = {
  name: string;
  description: string | null;
  inputSchema: Record<string, unknown> | null;
};

/** What `tool_search` hands back, in the JSON Schema an MCP server publishes; studio zod schemas are converted here. */
export async function findConnectedSchemas(
  server: string,
  names: string[],
): Promise<ConnectedToolSchema[]> {
  if (server === STUDIO_SERVER) {
    const wanted = new Set(names);
    return (await loadStudio())
      .filter((tool) => wanted.has(tool.name))
      .map((tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: z.toJSONSchema(tool.inputSchema) as Record<
          string,
          unknown
        >,
      }));
  }
  return (await findToolSchemas(server, names)).map((row) => ({
    name: row.name,
    description: row.description ?? null,
    inputSchema: (row.inputSchema as Record<string, unknown> | null) ?? null,
  }));
}

/**
 * Run one, wherever it lives. Long answers are folded (lib/sandbox fold). Failures are reported,
 * not thrown; a server that wants the user to sign in first comes back as its own status with the url.
 */
export async function callConnectedTool(
  sandbox: Sandbox,
  server: string,
  name: string,
  args: Record<string, unknown> | undefined,
  abortSignal?: AbortSignal,
): Promise<McpCallOutcome> {
  try {
    const text =
      server === STUDIO_SERVER
        ? await callStudioTool(sandbox, name, args, abortSignal)
        : await callMcpTool(server, name, args);
    if (typeof text !== "string") return text;
    return {
      status: "ok",
      text: await sandbox.fold(text, `${server}-${name}`),
    };
  } catch (error) {
    if (error instanceof McpAuthRequiredError) {
      return {
        status: "auth_required",
        server,
        authorizationUrl: error.authorizationUrl,
      };
    }
    return { status: "error", text: errorToString(error) };
  }
}

async function callStudioTool(
  sandbox: Sandbox,
  name: string,
  args: Record<string, unknown> | undefined,
  abortSignal?: AbortSignal,
): Promise<string> {
  const tool = (await loadStudio()).find((one) => one.name === name);
  // A name the listing had a moment ago can be gone: a key was removed
  if (!tool) {
    throw new Error(
      `"${name}" is not in the ${STUDIO_SERVER} right now — the key that runs it is gone.`,
    );
  }
  return tool.execute(args ?? {}, { sandbox, abortSignal });
}

/** Definitions come from what the last connect stored (mcp.query); a session is opened only for a tool that runs (mcp.manager). */
async function callMcpTool(
  server: string,
  name: string,
  args: Record<string, unknown> | undefined,
): Promise<string | McpCallOutcome> {
  const outcome = flattenToolResult(
    await mcpManager.callTool(server, name, args),
  );
  return outcome.status === "ok" ? outcome.text : outcome;
}

type ToolResultContent = {
  type: string;
  text?: string;
  mimeType?: string;
  [key: string]: unknown;
};

/**
 * MCP answers with content blocks; non-text blocks are named, not carried (one base64 screenshot
 * is a whole context window). The older bare `toolResult` shape some servers still send is read too.
 */
export function flattenToolResult(result: unknown): McpCallOutcome {
  const payload = (result ?? {}) as {
    content?: unknown;
    isError?: boolean;
    toolResult?: unknown;
  };
  const failed = payload.isError === true;

  if (!Array.isArray(payload.content)) {
    // The bare shape. JSON stays JSON — better than "[object Object]"
    const text =
      payload.toolResult === undefined
        ? ""
        : typeof payload.toolResult === "string"
          ? payload.toolResult
          : JSON.stringify(payload.toolResult);
    return { status: failed ? "error" : "ok", text: text || fallback(failed) };
  }

  const text = (payload.content as ToolResultContent[])
    .map((block) =>
      block.type === "text" && typeof block.text === "string"
        ? block.text
        : `[${block.type}${block.mimeType ? ` ${block.mimeType}` : ""} — not shown]`,
    )
    .join("\n")
    .trim();

  return { status: failed ? "error" : "ok", text: text || fallback(failed) };
}

const fallback = (failed: boolean) =>
  failed ? "The tool failed without a message." : "Done.";
