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
 * First-party servers only, each one reachable at the URL below. Most sign in
 * with OAuth and ask nothing up front; a few want a token pasted into the
 * header (GitHub, whose server skips OAuth discovery), and the docs servers
 * need no account at all. Two stdio entries at the end drive a browser.
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
    name: "linear",
    icon: "linear.app",
    description: "Issues, projects, and cycles",
    config: { url: "https://mcp.linear.app/mcp" },
  },
  {
    name: "slack",
    icon: "slack.com",
    description: "Channels, messages, and search",
    config: { url: "https://mcp.slack.com/mcp" },
  },
  {
    name: "atlassian",
    icon: "atlassian.com",
    description: "Jira and Confluence",
    config: { url: "https://mcp.atlassian.com/v1/mcp" },
  },
  {
    name: "asana",
    icon: "asana.com",
    description: "Tasks, projects, and portfolios",
    config: { url: "https://mcp.asana.com/mcp" },
  },
  {
    name: "monday",
    icon: "monday.com",
    description: "Boards, items, and updates",
    config: { url: "https://mcp.monday.com/mcp" },
  },
  {
    name: "clickup",
    icon: "clickup.com",
    description: "Tasks, docs, and spaces",
    config: { url: "https://mcp.clickup.com/mcp" },
  },
  {
    name: "airtable",
    icon: "airtable.com",
    description: "Bases, tables, and records",
    config: { url: "https://mcp.airtable.com/mcp" },
  },
  {
    name: "box",
    icon: "box.com",
    description: "Files, folders, and content search",
    config: { url: "https://mcp.box.com/mcp" },
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
    name: "sanity",
    icon: "sanity.io",
    description: "Structured content and datasets",
    config: { url: "https://mcp.sanity.io/mcp" },
  },
  {
    name: "webflow",
    icon: "webflow.com",
    description: "Sites, pages, and CMS collections",
    config: { url: "https://mcp.webflow.com/mcp" },
  },
  {
    name: "wix",
    icon: "wix.com",
    description: "Sites, stores, and bookings",
    config: { url: "https://mcp.wix.com/mcp" },
  },
  {
    name: "hubspot",
    icon: "hubspot.com",
    description: "Contacts, deals, and companies",
    config: { url: "https://app.hubspot.com/mcp/v1/http" },
  },
  {
    name: "attio",
    icon: "attio.com",
    description: "CRM records and lists",
    config: { url: "https://mcp.attio.com/mcp" },
  },
  {
    name: "intercom",
    icon: "intercom.com",
    description: "Conversations and support tickets",
    config: { url: "https://mcp.intercom.com/mcp" },
  },
  {
    name: "fireflies",
    icon: "fireflies.ai",
    description: "Meeting transcripts and summaries",
    config: { url: "https://mcp.fireflies.ai/mcp" },
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
    name: "square",
    icon: "squareup.com",
    description: "Payments, catalog, and orders",
    config: { url: "https://mcp.squareup.com/mcp" },
  },
  {
    name: "ramp",
    icon: "ramp.com",
    description: "Spend, cards, and transactions",
    config: { url: "https://mcp.ramp.com/mcp" },
  },
  {
    name: "vercel",
    icon: "vercel.com",
    description: "Deployments and projects",
    config: { url: "https://mcp.vercel.com" },
  },
  {
    name: "netlify",
    icon: "netlify.com",
    description: "Sites, builds, and deploys",
    config: { url: "https://mcp.netlify.com/mcp" },
  },
  {
    name: "cloudflare",
    icon: "cloudflare.com",
    description: "Workers bindings — D1, R2, KV",
    config: { url: "https://bindings.mcp.cloudflare.com/mcp" },
  },
  {
    name: "supabase",
    icon: "supabase.com",
    description: "Projects, tables, and SQL",
    config: { url: "https://mcp.supabase.com/mcp" },
  },
  {
    name: "neon",
    icon: "neon.tech",
    description: "Postgres branches and queries",
    config: { url: "https://mcp.neon.tech/mcp" },
  },
  {
    name: "prisma",
    icon: "prisma.io",
    description: "Postgres databases and schema",
    config: { url: "https://mcp.prisma.io/mcp" },
  },
  {
    name: "sentry",
    icon: "sentry.io",
    description: "Errors and performance issues",
    config: { url: "https://mcp.sentry.dev/mcp" },
  },
  {
    name: "grafana",
    icon: "grafana.com",
    description: "Dashboards, metrics, and alerts",
    config: { url: "https://mcp.grafana.com/mcp" },
  },
  {
    name: "semgrep",
    icon: "semgrep.dev",
    description: "Scan code for security findings",
    config: { url: "https://mcp.semgrep.ai/mcp" },
  },
  {
    name: "postman",
    icon: "postman.com",
    description: "Collections, environments, and requests",
    config: { url: "https://mcp.postman.com/mcp" },
  },
  {
    name: "resend",
    icon: "resend.com",
    description: "Send email and manage audiences",
    config: { url: "https://mcp.resend.com/mcp" },
  },
  {
    name: "hugging-face",
    icon: "huggingface.co",
    description: "Models, datasets, and Spaces",
    config: { url: "https://huggingface.co/mcp" },
  },
  {
    name: "apify",
    icon: "apify.com",
    description: "Run scrapers and automation actors",
    config: { url: "https://mcp.apify.com" },
  },
  {
    name: "exa",
    icon: "exa.ai",
    description: "Web search for agents",
    config: { url: "https://mcp.exa.ai/mcp" },
  },
  {
    name: "kagi",
    icon: "kagi.com",
    description: "Search, summarize, and answer",
    config: { url: "https://mcp.kagi.com/mcp" },
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
    name: "microsoft-learn",
    icon: "learn.microsoft.com",
    description: "Microsoft and Azure docs — no account",
    config: { url: "https://learn.microsoft.com/api/mcp" },
  },
  {
    name: "aws-knowledge",
    icon: "aws.amazon.com",
    description: "AWS docs and API references — no account",
    config: { url: "https://knowledge-mcp.global.api.aws" },
  },
  {
    name: "cloudflare-docs",
    icon: "developers.cloudflare.com",
    description: "Cloudflare docs — no account",
    config: { url: "https://docs.mcp.cloudflare.com/mcp" },
  },
  {
    name: "stack-overflow",
    icon: "stackoverflow.com",
    description: "Questions, answers, and teams",
    config: { url: "https://mcp.stackoverflow.com" },
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
