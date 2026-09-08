"use client";

import {
  Check,
  ChevronDown,
  ChevronRight,
  Play,
  Plus,
  RefreshCw,
  Server,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { queryKey } from "@/app/api/query-key";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import JsonView from "@/components/ui/json-view";
import { notify } from "@/components/ui/notify";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import {
  type ConnectSummary,
  callToolAction,
  deleteServerAction,
  refreshServerAction,
  registerServerAction,
} from "@/features/connectors/mcp.action";
import {
  MCP_PRESETS,
  type MCPPreset,
  presetIconFor,
} from "@/features/connectors/mcp.const";
import {
  isRemoteConfig,
  MCPConfigSchema,
  MCPRemoteConfigSchema,
  type MCPServer,
  type MCPServerConfig,
  type MCPServerForm,
  MCPServerFormSchema,
  MCPServerJsonSchema,
  type MCPServerSummary,
  MCPStdioConfigSchema,
  type MCPTool,
} from "@/features/connectors/mcp.schema";
import {
  SettingDialogContent,
  SettingError,
  SettingFilter,
  SettingGroup,
  SettingItems,
  SettingRailNote,
  SettingScreen,
  SettingSkeleton,
  SettingToolbar,
} from "@/features/settings/components/setting-ui";
import { useObjectState } from "@/hooks/use-object-state";
import { schemaToType } from "@/lib/json-schema";
import { useServerAction } from "@/lib/protocol/use-server-action";
import { revalidate, useServerRoute } from "@/lib/protocol/use-server-route";
import { cn, faviconUrl } from "@/lib/utils";

/** Connected servers as rows, then the presets as a grid you can scan. */
export function McpSetting() {
  const [filter, setFilter] = useState("");
  const {
    data: servers = [],
    isLoading,
    error,
  } = useServerRoute<MCPServerSummary[]>(queryKey.mcp);

  if (isLoading) return <SettingSkeleton rows={3} />;
  if (error) return <SettingError message={error.message} />;

  const tools = servers.reduce((sum, server) => sum + server.toolCount, 0);
  const failed = servers.filter((server) => server.lastError).length;

  return (
    <SettingScreen
      footer={
        <SettingRailNote>
          {servers.length === 0 ? (
            "Nothing connected yet — a preset is the shortest way in"
          ) : (
            <>
              {servers.length} connected · {tools} tools
              {failed > 0 && ` · ${failed} failed`}
            </>
          )}
        </SettingRailNote>
      }
    >
      <SettingGroup label="Connected">
        <SettingItems
          addRow={{ label: "Add server", onClick: () => openMcpRegister() }}
        >
          {servers.map((server) => (
            <ServerRow key={server.name} server={server} />
          ))}
        </SettingItems>
      </SettingGroup>

      <PresetSection
        filter={filter}
        onFilter={setFilter}
        onPreset={openMcpRegister}
      />
    </SettingScreen>
  );
}

function McpServerDialog({
  name,
  onDone,
}: {
  name: string;
  onDone: () => void;
}) {
  // Tools come with the detail read, not the list
  const { data: server, isLoading } = useServerRoute<MCPServer>(
    queryKey.mcpServer(name),
  );
  const [reconnect, reconnecting] = useServerAction(refreshServerAction, {
    ...CONNECT_OPTIONS,
    onOk: (summary) => {
      CONNECT_OPTIONS.onOk(summary);
      revalidate(queryKey.mcpServer(name));
    },
  });
  const [remove, removing] = useServerAction(deleteServerAction, {
    okMessage: "Server deleted",
    onOk: () => {
      // Close first: revalidating while this dialog still subscribes to the deleted server toasts a 404
      onDone();
      revalidate(queryKey.mcp);
    },
  });

  const confirmRemove = async () => {
    const confirmed = await notify.confirm({
      title: `Delete ${name}?`,
      description: "Its connection and saved authorization go with it.",
      okText: "Delete",
      destructive: true,
    });
    if (confirmed) remove(name);
  };

  if (isLoading) return <SettingSkeleton rows={4} />;
  if (!server) return null;

  const count = server.tools.length;

  const transport = isRemoteConfig(server.config) ? "HTTP" : "STDIO";

  return (
    <SettingDialogContent
      title={server.name}
      description={
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="shrink-0 rounded-sm bg-muted px-1.5 py-0.5 font-mono text-[10px]">
            {transport}
          </span>
          <span className="truncate font-mono">
            {describeConfig(server.config)}
          </span>
        </span>
      }
      footer={
        <>
          <Button variant="ghost" loading={removing} onClick={confirmRemove}>
            <Trash2 />
            Delete
          </Button>
          <Button
            variant="outline"
            loading={reconnecting}
            onClick={() => reconnect(server.name)}
          >
            <RefreshCw />
            Reconnect
          </Button>
        </>
      }
    >
      {server.lastError && (
        <p className="rounded-lg bg-destructive/10 px-3 py-2 font-mono text-xs text-destructive">
          {server.lastError}
        </p>
      )}

      <p className="text-right font-mono text-xs text-muted-foreground">
        {count} {count === 1 ? "tool" : "tools"}
      </p>

      {server.tools.map((tool) => (
        <ToolCard key={tool.name} tool={tool} serverName={server.name} />
      ))}
    </SettingDialogContent>
  );
}

function ServerRow({ server }: { server: MCPServerSummary }) {
  const count = server.toolCount;
  const status = server.lastError ? "error" : count > 0 ? "connected" : "idle";

  return (
    <button
      type="button"
      onClick={() => {
        notify.component({
          className: "sm:max-w-3xl",
          renderer: ({ close }) => (
            <McpServerDialog name={server.name} onDone={close} />
          ),
        });
      }}
      className="group flex w-full items-center gap-3 p-4 text-left outline-none transition-colors hover:bg-muted/50 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset"
    >
      <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground">
        <ServerTile server={server} />
      </span>

      <span className="min-w-0 flex-1 space-y-0.5">
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="truncate text-sm font-medium">{server.name}</span>
          {status === "connected" && (
            <Check className="size-3 shrink-0 text-muted-foreground" />
          )}
        </span>

        {/* A tool count means the server answered; otherwise the reason takes that spot */}
        <span className="block truncate text-xs text-muted-foreground">
          {status === "error" ? (
            <span className="text-destructive">{server.lastError}</span>
          ) : (
            <>
              {count > 0
                ? `${count} ${count === 1 ? "tool" : "tools"}`
                : "No tools yet"}
              <span className="font-mono text-[11px] text-muted-foreground/70">
                {" · "}
                {describeConfig(server.config)}
              </span>
            </>
          )}
        </span>
      </span>

      <ChevronRight className="size-4 shrink-0 text-muted-foreground/60 transition-colors group-hover:text-foreground" />
    </button>
  );
}

function ServerTile({ server }: { server: MCPServerSummary }) {
  const icon = presetIconFor(server);
  if (!icon) return <Server className="size-4" />;
  return (
    // biome-ignore lint/performance/noImgElement: small external favicon
    <img src={faviconUrl(icon)} alt="" className="size-5" />
  );
}

function ToolCard({ tool, serverName }: { tool: MCPTool; serverName: string }) {
  const [open, setOpen] = useState(false);
  const [testing, setTesting] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const schemas = (
    [
      ["inputSchema", tool.inputSchema],
      ["outputSchema", tool.outputSchema],
    ] as const
  ).filter(([, schema]) => schema);

  return (
    <div className="rounded-xl border border-border/60 bg-background p-4">
      <div className="min-w-0 space-y-1">
        <span className="block truncate font-mono text-sm">{tool.name}</span>
        {tool.description ? (
          <p
            className={cn(
              "text-xs text-muted-foreground",
              !expanded && "line-clamp-2",
              tool.description.length > 140 && "cursor-pointer",
            )}
            onClick={() => setExpanded(!expanded)}
          >
            {tool.description}
          </p>
        ) : null}
      </div>

      <div className="mt-2 flex justify-end gap-1">
        {schemas.length > 0 && (
          <Button
            size="xs"
            variant="ghost"
            className="font-mono"
            onClick={() => setOpen(!open)}
          >
            {open ? <ChevronDown /> : <ChevronRight />}
            Schema
          </Button>
        )}
        <Button
          size="xs"
          variant="ghost"
          className="font-mono"
          onClick={() => setTesting(!testing)}
        >
          {testing ? <ChevronDown /> : <ChevronRight />}
          Test
        </Button>
      </div>

      {open ? (
        <div className="mt-2 space-y-3 overflow-x-auto rounded-lg border border-input p-3">
          {schemas.map(([label, schema]) => (
            <div key={label} className="space-y-1">
              <span className="block font-mono text-xs text-muted-foreground">
                {label === "inputSchema" ? "in" : "out"}
              </span>
              <pre className="font-mono text-xs leading-relaxed whitespace-pre">
                {schemaToType(schema)}
              </pre>
            </div>
          ))}
        </div>
      ) : null}

      {testing ? <ToolTester tool={tool} serverName={serverName} /> : null}
    </div>
  );
}

/** Runs a tool with raw JSON args and shows the server's answer as is. */
function ToolTester({
  tool,
  serverName,
}: {
  tool: MCPTool;
  serverName: string;
}) {
  const [input, setInput] = useState(() => templateFor(tool));
  const [parseError, setParseError] = useState("");
  // Results show inline, so no toast
  const [call, running, result, callError, reset] = useServerAction(
    callToolAction,
    { errorMessage: false },
  );
  const error = parseError || callError;

  const run = () => {
    let args: Record<string, unknown> | undefined;
    try {
      args = input.trim() ? JSON.parse(input) : undefined;
    } catch {
      setParseError("Not valid JSON");
      return;
    }

    setParseError("");
    reset();
    call(serverName, tool.name, args);
  };

  return (
    <div className="mt-2 space-y-2 rounded-lg border border-input p-3">
      <Textarea
        value={input}
        onChange={(e) => setInput(e.target.value)}
        spellCheck={false}
        className="min-h-24 resize-none font-mono text-xs"
      />

      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-xs text-destructive">{error}</span>
        <Button size="sm" loading={running} onClick={run}>
          {!running && <Play />}
          Run
        </Button>
      </div>

      {result !== undefined && (
        <div className="overflow-x-auto rounded-lg bg-muted/40 p-3">
          <JsonView data={result} initialExpandDepth={3} />
        </div>
      )}
    </div>
  );
}

/** One empty slot per schema property. */
function templateFor(tool: MCPTool): string {
  const properties = tool.inputSchema?.properties;
  if (!properties || typeof properties !== "object") return "{}";

  const sample: Record<string, unknown> = {};
  for (const [key, spec] of Object.entries(
    properties as Record<string, { type?: string }>,
  )) {
    sample[key] =
      spec?.type === "number" || spec?.type === "integer"
        ? 0
        : spec?.type === "boolean"
          ? false
          : spec?.type === "array"
            ? []
            : spec?.type === "object"
              ? {}
              : "";
  }
  return JSON.stringify(sample, null, 2);
}

type Mode = "http" | "stdio" | "json";

/** A header / env editor row; the id keeps React keys stable across deletes. */
type Pair = { id: string; key: string; value: string };

/** What every input mode produces, so submit is one code path. */
type Draft = {
  value: { name: string | null; config: MCPServerConfig } | null;
  error: string;
};

/** Fields for one transport, or a pasted JSON block; switching modes carries the config over. */
export function openMcpRegister(initial?: MCPServerForm) {
  return notify.component({
    className: "sm:max-w-lg",
    renderer: ({ close }) => <McpRegister initial={initial} onDone={close} />,
  });
}

function McpRegister({
  initial,
  onDone,
}: {
  /** A preset; the form opens filled in on its transport. */
  initial?: MCPServerForm;
  onDone: () => void;
}) {
  const remote =
    initial && isRemoteConfig(initial.config) ? initial.config : undefined;
  const stdio =
    initial && !isRemoteConfig(initial.config) ? initial.config : undefined;

  // One object: switching transport writes several fields at once
  const [fields, patch] = useObjectState({
    mode: (stdio ? "stdio" : "http") as Mode,
    name: initial?.name ?? "",
    url: remote?.url ?? "",
    headers: toPairs(remote?.headers),
    clientId: remote?.oauthClient?.clientId ?? "",
    clientSecret: remote?.oauthClient?.clientSecret ?? "",
    command: stdio?.command ?? "",
    args: (stdio?.args ?? []).join(" "),
    env: toPairs(stdio?.env),
    raw: "",
  });
  const {
    mode,
    name,
    url,
    headers,
    clientId,
    clientSecret,
    command,
    args,
    env,
    raw,
  } = fields;

  const [register, busy] = useServerAction(registerServerAction, {
    ...CONNECT_OPTIONS,
    onOk: (summary) => {
      CONNECT_OPTIONS.onOk(summary);
      // A failed connect keeps the form open so the config can be fixed and retried
      if (summary.status !== "error") onDone();
    },
  });

  const draft: Draft = useMemo(() => {
    if (mode === "json") return fromJson(raw);
    if (mode === "http")
      return fromRemoteFields(url, headers, clientId, clientSecret);
    return fromStdioFields(command, args, env);
  }, [mode, raw, url, headers, clientId, clientSecret, command, args, env]);

  // Errors wait until typing settles; JSON mid-keystroke is always broken
  const signature =
    mode === "json"
      ? raw
      : JSON.stringify([
          mode,
          url,
          headers,
          clientId,
          clientSecret,
          command,
          args,
          env,
        ]);
  const [settled, setSettled] = useState(signature);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(signature), 700);
    return () => clearTimeout(timer);
  }, [signature]);
  const error = settled === signature ? draft.error : "";

  // A name from pasted JSON is a suggestion; typed wins
  const effectiveName = name || draft.value?.name || "";
  const form = MCPServerFormSchema.safeParse({
    name: effectiveName,
    config: draft.value?.config,
  });

  /** Carries a valid config across a mode switch. */
  function switchMode(next: Mode) {
    const config = draft.value?.config;
    if (!config) return patch({ mode: next });

    if (next === "json") {
      return patch({ mode: next, raw: JSON.stringify(config, null, 2) });
    }
    if (next === "http" && isRemoteConfig(config)) {
      return patch({
        mode: next,
        url: config.url,
        headers: toPairs(config.headers),
        clientId: config.oauthClient?.clientId ?? "",
        clientSecret: config.oauthClient?.clientSecret ?? "",
      });
    }
    if (next === "stdio" && !isRemoteConfig(config)) {
      return patch({
        mode: next,
        command: config.command,
        args: (config.args ?? []).join(" "),
        env: toPairs(config.env),
      });
    }
    patch({ mode: next });
  }

  /** Back to fields, on whichever transport the pasted config uses. */
  function toFields() {
    const config = draft.value?.config;
    switchMode(config && !isRemoteConfig(config) ? "stdio" : "http");
  }

  const jsonToggle = (
    <span className="flex items-center gap-2 font-mono text-xs text-muted-foreground">
      JSON
      <Switch
        size="sm"
        checked={mode === "json"}
        onCheckedChange={(on) => (on ? switchMode("json") : toFields())}
      />
    </span>
  );

  return (
    <SettingDialogContent
      title="Add MCP server"
      description="Its tools become available to Thursday and every sub-agent."
      footer={
        <>
          <Button variant="ghost" onClick={onDone}>
            Cancel
          </Button>
          <Button
            disabled={!form.success}
            loading={busy}
            onClick={() => {
              if (form.success && !busy) register(form.data);
            }}
          >
            Connect
          </Button>
        </>
      }
    >
      <div className="space-y-6">
        <Field>
          <FieldLabel>Name</FieldLabel>
          <Input
            value={effectiveName}
            onChange={(e) => patch({ name: e.target.value })}
            placeholder="notion"
            spellCheck={false}
          />
        </Field>

        {mode === "json" ? (
          <Field>
            <div className="flex min-h-6 items-center justify-between gap-2">
              <FieldLabel>JSON</FieldLabel>
              {jsonToggle}
            </div>
            {/* Textarea is field-sizing-content; `rows` would do nothing */}
            <Textarea
              value={raw}
              onChange={(e) => patch({ raw: e.target.value })}
              spellCheck={false}
              placeholder={PLACEHOLDER}
              className="min-h-64 resize-none font-mono text-xs"
            />
          </Field>
        ) : (
          <Tabs
            value={mode}
            onValueChange={(value) => switchMode(value as Mode)}
            className="gap-6"
          >
            <Field>
              <div className="flex min-h-6 items-center justify-between gap-2">
                <FieldLabel>Transport</FieldLabel>
                {jsonToggle}
              </div>
              <TabsList className="w-full">
                <TabsTrigger value="http">HTTP</TabsTrigger>
                <TabsTrigger value="stdio">STDIO</TabsTrigger>
              </TabsList>
            </Field>

            <TabsContent value="http" className="space-y-6">
              <Field>
                <FieldLabel>URL</FieldLabel>
                <Input
                  value={url}
                  onChange={(e) => patch({ url: e.target.value })}
                  placeholder="https://mcp.notion.com/mcp"
                  spellCheck={false}
                  className="font-mono text-xs"
                />
              </Field>
              <PairRows
                label="Headers"
                pairs={headers}
                onChange={(headers) => patch({ headers })}
                keyPlaceholder="Authorization"
                valuePlaceholder="Bearer sk-..."
              />
              <Field>
                <FieldLabel>OAuth client</FieldLabel>
                <div className="flex gap-2">
                  <Input
                    value={clientId}
                    onChange={(e) => patch({ clientId: e.target.value })}
                    placeholder="Client ID"
                    spellCheck={false}
                    className="font-mono text-xs"
                  />
                  <Input
                    value={clientSecret}
                    onChange={(e) => patch({ clientSecret: e.target.value })}
                    placeholder="Client secret"
                    spellCheck={false}
                    type="password"
                    className="font-mono text-xs"
                  />
                </div>
                <p className="text-xs text-muted-foreground">
                  Only for servers that refuse to register clients on their own,
                  like Figma. Leave empty and one is created during sign-in.
                </p>
              </Field>
            </TabsContent>

            <TabsContent value="stdio" className="space-y-6">
              <Field>
                <FieldLabel>Command</FieldLabel>
                <Input
                  value={command}
                  onChange={(e) => patch({ command: e.target.value })}
                  placeholder="npx"
                  spellCheck={false}
                  className="font-mono text-xs"
                />
              </Field>
              <Field>
                <FieldLabel>Args</FieldLabel>
                <Input
                  value={args}
                  onChange={(e) => patch({ args: e.target.value })}
                  placeholder="-y @notionhq/notion-mcp-server"
                  spellCheck={false}
                  className="font-mono text-xs"
                />
              </Field>
              <PairRows
                label="Env"
                pairs={env}
                onChange={(env) => patch({ env })}
                keyPlaceholder="NOTION_TOKEN"
                valuePlaceholder="ntn_..."
              />
            </TabsContent>
          </Tabs>
        )}
        {error && <p className="font-mono text-xs text-destructive">{error}</p>}
      </div>
    </SettingDialogContent>
  );
}

/** key/value editor shared by headers and env. */
function PairRows({
  label,
  pairs,
  onChange,
  keyPlaceholder,
  valuePlaceholder,
}: {
  label: string;
  pairs: Pair[];
  onChange: (pairs: Pair[]) => void;
  keyPlaceholder: string;
  valuePlaceholder: string;
}) {
  const patch = (id: string, part: Partial<Pair>) =>
    onChange(
      pairs.map((pair) => (pair.id === id ? { ...pair, ...part } : pair)),
    );

  return (
    <Field>
      <FieldLabel>{label}</FieldLabel>
      <div className="space-y-2">
        {pairs.map((pair) => (
          <div key={pair.id} className="flex gap-2">
            <Input
              value={pair.key}
              onChange={(e) => patch(pair.id, { key: e.target.value })}
              placeholder={keyPlaceholder}
              spellCheck={false}
              className="font-mono text-xs"
            />
            <Input
              value={pair.value}
              onChange={(e) => patch(pair.id, { value: e.target.value })}
              placeholder={valuePlaceholder}
              spellCheck={false}
              className="font-mono text-xs"
            />
            <Button
              variant="ghost"
              size="icon"
              onClick={() =>
                onChange(pairs.filter((row) => row.id !== pair.id))
              }
            >
              <X />
            </Button>
          </div>
        ))}
        <Button
          variant="outline"
          size="sm"
          onClick={() => onChange([...pairs, newPair()])}
        >
          <Plus />
          Add
        </Button>
      </div>
    </Field>
  );
}

const newPair = (key = "", value = ""): Pair => ({
  id: crypto.randomUUID(),
  key,
  value,
});

const toPairs = (record?: Record<string, string>) =>
  Object.entries(record ?? {}).map(([key, value]) => newPair(key, value));

/** Rows without a key are still being typed and do not reach the config. */
const toRecord = (pairs: Pair[]) => {
  const filled = pairs.filter((pair) => pair.key.trim());
  if (!filled.length) return undefined;
  return Object.fromEntries(filled.map((p) => [p.key.trim(), p.value]));
};

function fromRemoteFields(
  url: string,
  headers: Pair[],
  clientId: string,
  clientSecret: string,
): Draft {
  const result = MCPRemoteConfigSchema.safeParse({
    url: url.trim(),
    headers: toRecord(headers),
    oauthClient: clientId.trim()
      ? { clientId: clientId.trim(), clientSecret: clientSecret.trim() }
      : undefined,
  });
  if (result.success)
    return { value: { name: null, config: result.data }, error: "" };
  return { value: null, error: url.trim() ? "Needs a valid url" : "" };
}

function fromStdioFields(command: string, args: string, env: Pair[]): Draft {
  const result = MCPStdioConfigSchema.safeParse({
    command: command.trim(),
    args: args.split(/\s+/).filter(Boolean),
    env: toRecord(env),
  });
  if (result.success)
    return { value: { name: null, config: result.data }, error: "" };
  return { value: null, error: command.trim() ? "Needs a command" : "" };
}

const PLACEHOLDER = `/** STDIO Example */
{
  "command": "node",
  "args": ["index.js"],
  "env": {
    "OPENAI_API_KEY": "sk-..."
  }
}

/** SSE, Streamable HTTP Example */
{
  "url": "https://api.example.com",
  "headers": {
    "Authorization": "Bearer sk-..."
  }
}`;

/** Unwraps a README-style `mcpServers` (or bare name map) block; the first server wins. */
function fromJson(raw: string): Draft {
  const text = raw.trim();
  if (!text) return { value: null, error: "" };

  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { value: null, error: "Not valid JSON" };
  }

  const bare = MCPConfigSchema.safeParse(json);
  if (bare.success) {
    return { value: { name: null, config: bare.data }, error: "" };
  }

  const wrapped = MCPServerJsonSchema.safeParse(json);
  if (!wrapped.success) {
    return { value: null, error: "Needs a url or a command" };
  }

  const map =
    "mcpServers" in wrapped.data ? wrapped.data.mcpServers : wrapped.data;
  const entry = Object.entries(map)[0];
  if (!entry) return { value: null, error: "No server in there" };

  return { value: { name: entry[0], config: entry[1] }, error: "" };
}

/** How often to check whether the OAuth popup closed, and when to give up. */
const OAUTH_POLL_MS = 700;
const OAUTH_WATCH_MS = 5 * 60_000;

/** Reports a connect outcome; shared by register and reconnect. */
export function reportConnect(summary: ConnectSummary) {
  if (summary.status === "auth_required" && summary.authorizationUrl) {
    // A popup: the callback page closes it when authorization finishes
    const popup = window.open(
      summary.authorizationUrl,
      "thursday-oauth",
      "popup,width=520,height=720",
    );
    toast.add({
      title: `${summary.name} needs authorization`,
      description: "Approve access in the window that just opened",
    });

    // The callback happens in that window; its closing is the only signal here.
    // The deadline keeps a forgotten popup from polling for the life of the tab
    const deadline = Date.now() + OAUTH_WATCH_MS;
    const timer = setInterval(() => {
      const closed = !popup || popup.closed;
      if (!closed && Date.now() < deadline) return;
      clearInterval(timer);
      // Prefix match also refreshes an open `mcpServer(name)` dialog
      if (closed) revalidate(queryKey.mcp);
    }, OAUTH_POLL_MS);
    return;
  }

  if (summary.status === "error") {
    toast.add({
      type: "error",
      title: `${summary.name} could not connect`,
      description: summary.error,
    });
    return;
  }

  toast.add({
    type: "success",
    title: `${summary.name} connected`,
    description: `${summary.toolCount} ${
      summary.toolCount === 1 ? "tool" : "tools"
    } available`,
  });
}

/** Refresh the list, then report. */
export const CONNECT_OPTIONS = {
  onOk: (summary: ConnectSummary) => {
    revalidate(queryKey.mcp);
    reportConnect(summary);
  },
} as const;

function PresetSection({
  filter,
  onFilter,
  onPreset,
}: {
  filter: string;
  onFilter: (next: string) => void;
  onPreset: (preset: MCPPreset) => void;
}) {
  const needle = filter.trim().toLowerCase();
  const shown = MCP_PRESETS.filter(
    (preset) =>
      !needle ||
      `${preset.name} ${preset.description}`.toLowerCase().includes(needle),
  );

  return (
    <section className="space-y-2">
      <SettingToolbar
        count={needle ? `${shown.length} of ${MCP_PRESETS.length}` : undefined}
      >
        <span className="shrink-0 font-mono text-xs text-muted-foreground">
          Presets
        </span>
        <SettingFilter
          value={filter}
          onChange={onFilter}
          placeholder="Filter presets"
          className="w-56"
        />
      </SettingToolbar>

      <div className="grid grid-cols-[repeat(4,minmax(0,1fr))] gap-3">
        {shown.map((preset) => (
          <button
            key={preset.name}
            type="button"
            onClick={() => onPreset(preset)}
            className="group relative flex flex-col gap-2 rounded-xl border border-border/60 p-3 text-left text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            <Plus className="absolute top-3 right-3 size-3.5 shrink-0 text-muted-foreground/50 group-hover:text-foreground" />
            <span className="grid size-6 shrink-0 place-items-center rounded-md bg-muted text-muted-foreground">
              {preset.icon ? (
                // biome-ignore lint/performance/noImgElement: small external favicon
                <img src={faviconUrl(preset.icon)} alt="" className="size-4" />
              ) : (
                <Server className="size-3.5" />
              )}
            </span>
            <span className="min-w-0">
              <span className="block truncate font-mono text-xs font-semibold">
                {preset.name}
              </span>
              <span className="block truncate text-xs">
                {preset.description}
              </span>
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}

function describeConfig(config: MCPServerConfig) {
  return isRemoteConfig(config)
    ? config.url
    : [config.command, ...(config.args ?? [])].join(" ");
}
