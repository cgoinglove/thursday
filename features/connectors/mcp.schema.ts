import { z } from "zod";
import { DateLikeSchema } from "@/lib/date-like";

/** Protocol shapes (config, tool info, oauth) and the rows the screen draws; the protocol shape is the stored shape. */

export const MCPRemoteConfigSchema = z.object({
  url: z.url(),
  headers: z.record(z.string(), z.string()).optional(),
  /** A hand-registered OAuth client, for servers that refuse dynamic registration (403 at DCR). Skips DCR when set. */
  oauthClient: z
    .object({
      clientId: z.string().min(1),
      clientSecret: z.string().optional(),
    })
    .optional(),
});

export const MCPStdioConfigSchema = z.object({
  command: z.string().min(1),
  args: z.array(z.string()).optional(),
  env: z.record(z.string(), z.string()).optional(),
});

export const MCPConfigSchema = z.union([
  MCPRemoteConfigSchema,
  MCPStdioConfigSchema,
]);

export const MCPToolInfoSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  // looseObject: a keyless z.object() strips every property and the schema comes back as {}
  inputSchema: z.looseObject({}).optional(),
  outputSchema: z.looseObject({}).optional(),
});

/**
 * What an OAuth flow leaves behind, one blob per server. The SDK owns the
 * shapes and round-trips them untouched. `codeVerifier`/`state` live only
 * between the redirect and the callback. Never send this to the browser.
 */
export const MCPOAuthDataSchema = z.object({
  clientInformation: z.looseObject({}).optional(),
  tokens: z.looseObject({}).optional(),
  authorizationServer: z.looseObject({}).optional(),
  codeVerifier: z.string().optional(),
  state: z.string().optional(),
});

export type MCPRemoteConfig = z.infer<typeof MCPRemoteConfigSchema>;

export type MCPStdioConfig = z.infer<typeof MCPStdioConfigSchema>;

export type MCPServerConfig = z.infer<typeof MCPConfigSchema>;

export type MCPToolInfo = z.infer<typeof MCPToolInfoSchema>;

export type MCPOAuthData = z.infer<typeof MCPOAuthDataSchema>;

/** Remote or stdio is decided by shape; the user is never asked. */
export function isRemoteConfig(
  config: MCPServerConfig,
): config is MCPRemoteConfig {
  return "url" in config;
}

/** How the agent points at a tool: server name and tool name as two fields, never joined. */
export type McpToolRef = {
  server: string;
  name: string;
};

export type McpCallOutcome =
  | { status: "ok"; text: string }
  /** The tool ran and refused; its own message, not an exception. */
  | { status: "error"; text: string }
  /** Nothing proceeds until the user signs in at `authorizationUrl`. */
  | { status: "auth_required"; server: string; authorizationUrl?: string };

/** A server list row. Tools are counted, not sent; one server can carry a hundred JSON schemas. */
export const MCPServerSummarySchema = z.object({
  name: z.string().min(1).max(40),
  config: MCPConfigSchema,
  toolCount: z.number().int(),
  lastError: z.string().nullish(),
});

/** A stored tool: the protocol shape plus the row id that bot pins point at. */
export const MCPToolSchema = MCPToolInfoSchema.extend({
  id: z.number().int(),
  description: z.string().nullish(),
});

/** One opened server: the summary plus its tools. */
export const MCPServerSchema = MCPServerSummarySchema.omit({
  toolCount: true,
}).extend({
  tools: MCPToolSchema.array().default([]),
  toolsSyncedAt: DateLikeSchema,
});

/** What the registration form produces; the rest is filled in while connecting. */
export const MCPServerFormSchema = z.object({
  name: z
    .string()
    .min(1, "Name is required")
    .max(40)
    .regex(/^[a-zA-Z0-9_-]+$/, "Only letters, numbers, - and _ are allowed"),
  config: MCPConfigSchema,
});

/** The shape copied from a server README: `{ mcpServers: {...} }` or the bare map. */
export const MCPServerJsonSchema = z.union([
  z.object({ mcpServers: z.record(z.string(), MCPConfigSchema) }),
  z.record(z.string(), MCPConfigSchema),
]);

export type MCPServerSummary = z.infer<typeof MCPServerSummarySchema>;

export type MCPTool = z.infer<typeof MCPToolSchema>;

export type MCPServer = z.infer<typeof MCPServerSchema>;

export type MCPServerForm = z.infer<typeof MCPServerFormSchema>;
