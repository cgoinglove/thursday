import { jsonSchema, type ToolSet, tool } from "ai";
import * as z from "zod";
import { TOOL_NAMES } from "@/features/ai/tools/tool-name";
import { findPinnedTools } from "@/features/connectors/mcp.query";
import type { Sandbox } from "@/lib/sandbox";
import {
  callConnectedTool,
  findConnectedSchemas,
  listConnectedServerNames,
  listConnectedToolNames,
} from "./connected";

/**
 * Connected tools are reached in two steps instead of loading every server's schemas:
 * `tool_search` fetches definitions by name, `tool_call` runs one. "Server" includes the app's
 * studio (config STUDIO_SERVER); where a tool lives is connected.ts's question.
 */

/** Definitions returned per search; schemas are large. */
const MAX_SCHEMAS = 8;

export const mcpToolSpec = {
  [TOOL_NAMES.tool_search]: {
    name: TOOL_NAMES.tool_search,
    // What it is, not when to reach for it: the Connected tools chapter says
    // that the listing carries names alone and that this is how a schema is got
    description: `Return the description and exact inputSchema of tools on a connected server, so they can be called with \`${TOOL_NAMES.tool_call}\`.`,
    parameters: z.object({
      server: z
        .string()
        .describe(
          "A server name, exactly as the Connected tools section writes it.",
        ),
      tools: z
        .string()
        .array()
        .describe(
          `Tool names listed under that server. Only the ones you may actually call — schemas are large, and at most ${MAX_SCHEMAS} come back.`,
        ),
    }),
  },

  [TOOL_NAMES.tool_call]: {
    name: TOOL_NAMES.tool_call,
    description: `Run one tool whose definition came back from \`${TOOL_NAMES.tool_search}\`.`,
    parameters: z.object({
      server: z.string().describe("The server the tool lives on."),
      tool: z.string().describe("Its name, as search returned it."),
      args: z
        .record(z.string(), z.unknown())
        .nullish()
        .describe(
          "Arguments matching the inputSchema search returned — do not guess. Null when it takes none.",
        ),
      description: z
        .string()
        .nullish()
        .describe(
          "One short line for the user: what this call is for. Shown on their screen while it runs.",
        ),
    }),
  },
} as const;

/**
 * Pinned tools skip the search and sit in the tool set with their schemas, named `<server>__<tool>`.
 * The server prefix keeps names apart across servers and away from the app's own tools (a server
 * exposing `bash` would silently replace the bot's shell; no app tool contains `__`). The prefix is
 * unconditional because a resumed bot replays history under the old names (bot.runner).
 * The input schema is the server's JSON Schema as published, never retyped in zod.
 */

/** Tool-name length most providers accept. */
const MAX_TOOL_NAME = 64;

const toolNameFor = (server: string, name: string) =>
  `${server.replace(/[^a-zA-Z0-9]+/g, "_")}__${name.replace(/[^a-zA-Z0-9_-]+/g, "_")}`.slice(
    0,
    MAX_TOOL_NAME,
  );

/** @param sandbox Folds long results into a file (Sandbox.fold), under the same cap as shell output (config TOOL_OUTPUT). */
export async function createMcpTools(
  botName: string,
  sandbox: Sandbox,
): Promise<ToolSet> {
  const [all, pinned] = await Promise.all([
    listConnectedToolNames(),
    findPinnedTools(botName),
  ]);
  const tools: ToolSet = {};

  for (const entry of pinned) {
    const key = toolNameFor(entry.server, entry.name);
    // Names that collide after truncation: the first one wins, the other stays behind search
    if (tools[key]) continue;

    tools[key] = tool({
      description:
        entry.description ?? `${entry.name} on the ${entry.server} server.`,
      inputSchema: jsonSchema(
        (entry.inputSchema as Record<string, unknown> | null) ?? {
          type: "object",
          properties: {},
        },
      ),
      execute: (args, { abortSignal }) =>
        callConnectedTool(
          sandbox,
          entry.server,
          entry.name,
          (args ?? undefined) as Record<string, unknown> | undefined,
          abortSignal,
        ),
    });
  }

  // The search pair only when something is left to find; otherwise `tool_search` could only refuse
  if (all.length > pinned.length) Object.assign(tools, searchPair(sandbox));
  return tools;
}

/** On a miss, say what exists so the model does not retry with synonyms. */
async function whatExists(server: string): Promise<string> {
  const names = (await listConnectedToolNames(server)).map((row) => row.name);
  if (names.length) {
    return `Tools on "${server}": ${names.join(", ")}.`;
  }
  const servers = await listConnectedServerNames();
  return servers.length
    ? `There is no server called "${server}". Connected: ${servers.join(", ")}.`
    : "Nothing is connected.";
}

const searchPair = (sandbox: Sandbox): ToolSet => ({
  [TOOL_NAMES.tool_search]: tool({
    description: mcpToolSpec[TOOL_NAMES.tool_search].description,
    inputSchema: mcpToolSpec[TOOL_NAMES.tool_search].parameters,
    execute: async ({ server, tools }) => {
      const asked = [
        ...new Set(tools.map((name) => name.trim()).filter(Boolean)),
      ];
      const wanted = asked.slice(0, MAX_SCHEMAS);
      const found = await findConnectedSchemas(server.trim(), wanted);

      if (!found.length) return { tools: [], note: await whatExists(server) };

      // Name what did not come back, so a misspelling is not read as "no such tool" and the cap is visible
      const missing = wanted.filter(
        (name) => !found.some((entry) => entry.name === name),
      );
      const trimmed = asked.slice(MAX_SCHEMAS);
      const notes = [
        missing.length ? `Not on "${server}": ${missing.join(", ")}.` : "",
        trimmed.length
          ? `Only ${MAX_SCHEMAS} at a time — ask again for: ${trimmed.join(", ")}.`
          : "",
      ].filter(Boolean);

      return {
        tools: found,
        ...(notes.length ? { note: notes.join(" ") } : {}),
      };
    },
  }),

  [TOOL_NAMES.tool_call]: tool({
    description: mcpToolSpec[TOOL_NAMES.tool_call].description,
    inputSchema: mcpToolSpec[TOOL_NAMES.tool_call].parameters,
    execute: async ({ server, tool: name, args }, { abortSignal }) => {
      const exists = (await listConnectedToolNames(server.trim())).some(
        (row) => row.name === name.trim(),
      );
      if (!exists) {
        return { status: "error", text: await whatExists(server) };
      }
      return callConnectedTool(
        sandbox,
        server.trim(),
        name.trim(),
        args ?? undefined,
        abortSignal,
      );
    },
  }),
});
