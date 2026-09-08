import { and, count, eq, inArray, notInArray, sql } from "drizzle-orm";
import { appEvents } from "@/app/api/events/app-event.server";
import { database } from "@/database/db";
import {
  botMcpToolTable,
  mcpServerTable,
  mcpToolTable,
} from "@/database/tables";
import {
  isRemoteConfig,
  type MCPOAuthData,
  type MCPServerConfig,
  type MCPToolInfo,
} from "@/features/connectors/mcp.schema";

/**
 * `oauth` holds tokens, so reads that reach the browser select columns
 * explicitly. Headers, env and the OAuth client are credentials too and stay
 * server-side with it.
 */
function publicConfig(config: MCPServerConfig): MCPServerConfig {
  return isRemoteConfig(config)
    ? { url: config.url }
    : { command: config.command, args: config.args };
}

export async function findAllServers() {
  const rows = await database
    .select({
      name: mcpServerTable.name,
      config: mcpServerTable.config,
      lastError: mcpServerTable.lastError,
      // leftJoin: a server with no tools is still a row with count 0
      toolCount: count(mcpToolTable.id),
    })
    .from(mcpServerTable)
    .leftJoin(mcpToolTable, eq(mcpToolTable.serverName, mcpServerTable.name))
    .groupBy(mcpServerTable.name);
  return rows.map((row) => ({ ...row, config: publicConfig(row.config) }));
}

/** One server with its tools. */
export async function findServerDetail(name: string) {
  const [server] = await database
    .select({
      name: mcpServerTable.name,
      config: mcpServerTable.config,
      lastError: mcpServerTable.lastError,
      toolsSyncedAt: mcpServerTable.toolsSyncedAt,
    })
    .from(mcpServerTable)
    .where(eq(mcpServerTable.name, name));
  if (!server) return null;

  return {
    ...server,
    config: publicConfig(server.config),
    tools: await findServerTools(name),
  };
}

/** A server's tools with ids; pins point at the id. */
export async function findServerTools(name: string) {
  return database
    .select({
      id: mcpToolTable.id,
      name: mcpToolTable.name,
      description: mcpToolTable.description,
      inputSchema: mcpToolTable.inputSchema,
      outputSchema: mcpToolTable.outputSchema,
    })
    .from(mcpToolTable)
    .where(eq(mcpToolTable.serverName, name))
    .orderBy(mcpToolTable.name);
}

/** Every tool of every server, light columns only (the bot form's pin picker). */
export function findAllTools() {
  return database
    .select({
      id: mcpToolTable.id,
      name: mcpToolTable.name,
      serverName: mcpToolTable.serverName,
      description: mcpToolTable.description,
    })
    .from(mcpToolTable)
    .orderBy(mcpToolTable.serverName, mcpToolTable.name);
}

/** Server and tool names only, for the prompt; schemas are the heavy column and stay behind `tool_search`. */
export function listToolNames(server?: string) {
  const query = database
    .select({ server: mcpToolTable.serverName, name: mcpToolTable.name })
    .from(mcpToolTable);
  return server
    ? query
        .where(eq(mcpToolTable.serverName, server))
        .orderBy(mcpToolTable.name)
    : query.orderBy(mcpToolTable.serverName, mcpToolTable.name);
}

/** Definitions of the named tools; the one read that carries schemas to the model. */
export function findToolSchemas(server: string, names: string[]) {
  if (!names.length) return Promise.resolve([]);
  return database
    .select({
      name: mcpToolTable.name,
      description: mcpToolTable.description,
      inputSchema: mcpToolTable.inputSchema,
    })
    .from(mcpToolTable)
    .where(
      and(
        eq(mcpToolTable.serverName, server),
        inArray(mcpToolTable.name, names),
      ),
    )
    .orderBy(mcpToolTable.name);
}

/**
 * This bot's pinned tools with schemas; they become tools directly, without
 * `tool_search`. Tools a server stopped reporting cascade away with their row.
 */
export function findPinnedTools(botName: string) {
  return database
    .select({
      server: mcpToolTable.serverName,
      name: mcpToolTable.name,
      description: mcpToolTable.description,
      inputSchema: mcpToolTable.inputSchema,
    })
    .from(botMcpToolTable)
    .innerJoin(mcpToolTable, eq(botMcpToolTable.toolId, mcpToolTable.id))
    .where(eq(botMcpToolTable.botName, botName))
    .orderBy(mcpToolTable.serverName, mcpToolTable.name);
}

/** Registered server names, for answering a missed lookup. */
export function listServerNames() {
  return database
    .select({ name: mcpServerTable.name })
    .from(mcpServerTable)
    .orderBy(mcpServerTable.name);
}

/** The whole row including credentials; for the manager, never a route. */
export async function findServer(name: string) {
  const [server] = await database
    .select()
    .from(mcpServerTable)
    .where(eq(mcpServerTable.name, name));
  return server ?? null;
}

/** Signals the screen to re-read; called at every write. */
const changed = () => appEvents.emit({ type: "mcp" });

/** Re-registering a name replaces its config. */
export async function upsertServer(input: {
  name: string;
  config: MCPServerConfig;
}) {
  const [server] = await database
    .insert(mcpServerTable)
    .values({ ...input, lastError: null })
    .onConflictDoUpdate({
      target: mcpServerTable.name,
      // Tools are left alone; the connect that follows syncs them
      set: { config: input.config, lastError: null },
    })
    .returning();
  changed();
  return server;
}

/**
 * After a successful connect. Upserts on (server_name, name) rather than
 * delete-and-insert: new ids would silently empty every bot's pins. Tools no
 * longer reported are deleted and their pins cascade.
 */
export async function syncServerTools(name: string, tools: MCPToolInfo[]) {
  await database.transaction(async (tx) => {
    if (tools.length) {
      await tx
        .insert(mcpToolTable)
        .values(tools.map((tool) => ({ ...tool, serverName: name })))
        .onConflictDoUpdate({
          target: [mcpToolTable.serverName, mcpToolTable.name],
          set: {
            description: excluded(mcpToolTable.description),
            inputSchema: excluded(mcpToolTable.inputSchema),
            outputSchema: excluded(mcpToolTable.outputSchema),
          },
        });
    }

    await tx.delete(mcpToolTable).where(
      tools.length
        ? and(
            eq(mcpToolTable.serverName, name),
            notInArray(
              mcpToolTable.name,
              tools.map((tool) => tool.name),
            ),
          )
        : eq(mcpToolTable.serverName, name),
    );

    await tx
      .update(mcpServerTable)
      .set({ lastError: null, toolsSyncedAt: new Date() })
      .where(eq(mcpServerTable.name, name));
  });
  changed();
}

/** The value the insert would have written. */
function excluded(column: { name: string }) {
  return sql.raw(`excluded."${column.name}"`);
}

/** After a failed connect. Tool rows stay: dropping them would clear every bot's pins on one timeout. */
export async function saveConnectionError(name: string, lastError: string) {
  await database
    .update(mcpServerTable)
    .set({ lastError })
    .where(eq(mcpServerTable.name, name));
  changed();
}

export async function saveOAuthData(name: string, oauth: MCPOAuthData | null) {
  await database
    .update(mcpServerTable)
    .set({ oauth })
    .where(eq(mcpServerTable.name, name));
  changed();
}

/** The OAuth callback only knows `state`. */
export async function findServerByOAuthState(state: string) {
  const [server] = await database
    .select()
    .from(mcpServerTable)
    .where(sql`json_extract(${mcpServerTable.oauth}, '$.state') = ${state}`);
  return server ?? null;
}

export async function deleteServer(name: string) {
  const removed = await database
    .delete(mcpServerTable)
    .where(eq(mcpServerTable.name, name))
    .returning();
  if (removed.length > 0) changed();
  return removed.length > 0;
}
