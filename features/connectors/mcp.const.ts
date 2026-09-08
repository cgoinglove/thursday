import {
  isRemoteConfig,
  type MCPServerConfig,
  type MCPServerForm,
} from "./mcp.schema";

/** Matches a server to a preset by endpoint (url / command), falling back to name. */
export function presetIconFor(server: {
  name: string;
  config: MCPServerConfig;
}): string | undefined {
  const trim = (url: string) => url.replace(/\/+$/, "");
  const match =
    MCP_PRESETS.find((preset) =>
      isRemoteConfig(preset.config)
        ? isRemoteConfig(server.config) &&
          trim(preset.config.url) === trim(server.config.url)
        : !isRemoteConfig(server.config) &&
          preset.config.command === server.config.command &&
          (preset.config.args ?? []).join(" ") ===
            (server.config.args ?? []).join(" "),
    ) ?? MCP_PRESETS.find((preset) => preset.name === server.name);
  return match?.icon;
}

/** A ready-made server; `icon` is the brand's domain, rendered as its favicon. */
export type MCPPreset = MCPServerForm & {
  description?: string;
  icon?: string;
};

/**
 * Official remote servers plus two stdio browser tools. OAuth servers ask
 * nothing up front; GitHub's remote server skips OAuth discovery and wants a
 * PAT in the header.
 */
export const MCP_PRESETS: MCPPreset[] = [
  {
    name: "notion",
    icon: "notion.so",
    description: "Pages, databases, and search",
    config: { url: "https://mcp.notion.com/mcp" },
  },
  {
    name: "github",
    icon: "github.com",
    description: "Repos, issues, PRs — paste a personal access token",
    config: {
      url: "https://api.githubcopilot.com/mcp/",
      headers: { Authorization: "Bearer <your-github-pat>" },
    },
  },
  {
    name: "figma",
    icon: "figma.com",
    description: "Design files and components",
    config: { url: "https://mcp.figma.com/mcp" },
  },
  {
    name: "canva",
    icon: "canva.com",
    description: "Create and manage designs",
    config: { url: "https://mcp.canva.com/mcp" },
  },
  {
    name: "linear",
    icon: "linear.app",
    description: "Issues, projects, and cycles",
    config: { url: "https://mcp.linear.app/mcp" },
  },
  {
    name: "stripe",
    icon: "stripe.com",
    description: "Payments, invoices, and customers",
    config: { url: "https://mcp.stripe.com" },
  },
  {
    name: "paypal",
    icon: "paypal.com",
    description: "Payments and orders",
    config: { url: "https://mcp.paypal.com/mcp" },
  },
  {
    name: "sentry",
    icon: "sentry.io",
    description: "Errors and performance issues",
    config: { url: "https://mcp.sentry.dev/mcp" },
  },
  {
    name: "atlassian",
    icon: "atlassian.com",
    description: "Jira and Confluence",
    config: { url: "https://mcp.atlassian.com/v1/mcp" },
  },
  {
    name: "vercel",
    icon: "vercel.com",
    description: "Deployments and projects",
    config: { url: "https://mcp.vercel.com" },
  },
  {
    name: "hugging-face",
    icon: "huggingface.co",
    description: "Models, datasets, and Spaces",
    config: { url: "https://huggingface.co/mcp" },
  },
  {
    name: "exa",
    icon: "exa.ai",
    description: "Web search for agents",
    config: { url: "https://mcp.exa.ai/mcp" },
  },
  {
    name: "context7",
    icon: "context7.com",
    description: "Up-to-date library docs",
    config: { url: "https://mcp.context7.com/mcp" },
  },
  {
    name: "deepwiki",
    icon: "deepwiki.com",
    description: "Ask questions about any GitHub repo",
    config: { url: "https://mcp.deepwiki.com/mcp" },
  },
  {
    name: "playwright",
    icon: "playwright.dev",
    description: "Drive a real browser",
    config: { command: "npx", args: ["@playwright/mcp@latest"] },
  },
  {
    name: "chrome-devtools",
    icon: "developer.chrome.com",
    description: "Inspect and debug Chrome",
    config: { command: "npx", args: ["chrome-devtools-mcp@latest"] },
  },
];
