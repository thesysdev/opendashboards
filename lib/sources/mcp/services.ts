/**
 * Known MCP servers, offered by name in the connector catalog. Each is a
 * preset on the one MCP connector: its endpoint is fixed here (the server
 * picks it from the key, never from the browser), and so is how people may
 * authenticate. Client-safe: nothing here is secret.
 *
 * Only servers checked to work: remote Streamable HTTP, and for OAuth,
 * discovery with PKCE and dynamic client registration. Read-only endpoints
 * where the server has one, since dashboards only read.
 */

export type McpAuth = "oauth" | "key";

export type McpService = {
  label: string;
  blurb: string;
  /** Logo code for SourceTile. */
  tile: string;
  url: string;
  /** How people may connect, in the order offered. OAuth is personal; a key can be shared with a team. */
  auth: readonly McpAuth[];
  /** For a key: where to create one, and which kind. */
  key?: { label: string; placeholder?: string; href: string; hint: string };
};

export const MCP_SERVICES = {
  linear: {
    label: "Linear",
    blurb: "Issues, projects and cycles",
    tile: "LN",
    url: "https://mcp.linear.app/mcp/readonly",
    auth: ["oauth", "key"],
    key: {
      label: "Personal API key",
      placeholder: "lin_api_…",
      href: "https://linear.app/settings/account/security",
      hint: "Create one under Settings → Security & access. Only the Read permission is needed.",
    },
  },
  jira: {
    label: "Jira",
    blurb: "Issues, sprints and projects, through Atlassian",
    tile: "JI",
    url: "https://mcp.atlassian.com/v2/mcp",
    auth: ["oauth"],
  },
  github: {
    label: "GitHub",
    blurb: "Pull requests, issues and releases",
    tile: "GH",
    url: "https://api.githubcopilot.com/mcp/readonly",
    auth: ["key"],
    key: {
      label: "Personal access token",
      placeholder: "github_pat_…",
      href: "https://github.com/settings/personal-access-tokens/new",
      hint: "Create a fine-grained token with read-only access to the repositories you want.",
    },
  },
  sentry: {
    label: "Sentry",
    blurb: "Errors, issues and releases",
    tile: "SE",
    url: "https://mcp.sentry.dev/mcp",
    auth: ["oauth"],
  },
  stripe: {
    label: "Stripe",
    blurb: "Payments, subscriptions and revenue",
    tile: "ST",
    url: "https://mcp.stripe.com",
    auth: ["oauth", "key"],
    key: {
      label: "Restricted key",
      placeholder: "rk_live_…",
      href: "https://dashboard.stripe.com/apikeys",
      hint: "Create a restricted key with Read access only. Never use your secret key.",
    },
  },
  amplitude: {
    label: "Amplitude",
    blurb: "Charts, events and cohorts (US region)",
    tile: "AM",
    url: "https://mcp.amplitude.com/mcp",
    auth: ["oauth"],
  },
  mixpanel: {
    label: "Mixpanel",
    blurb: "Events, funnels and retention",
    tile: "MX",
    url: "https://mcp.mixpanel.com/mcp",
    auth: ["oauth"],
  },
  intercom: {
    label: "Intercom",
    blurb: "Conversations, tickets and contacts",
    tile: "IC",
    url: "https://mcp.intercom.com/mcp",
    auth: ["oauth"],
  },
  attio: {
    label: "Attio",
    blurb: "Companies, people and deals",
    tile: "AT",
    url: "https://mcp.attio.com/mcp",
    auth: ["oauth"],
  },
} as const satisfies Record<string, McpService>;

export type McpServiceKey = keyof typeof MCP_SERVICES;

export const MCP_SERVICE_KEYS = Object.keys(MCP_SERVICES) as [McpServiceKey, ...McpServiceKey[]];

export function mcpService(key: string | undefined): McpService | null {
  return key && Object.hasOwn(MCP_SERVICES, key) ? MCP_SERVICES[key as McpServiceKey] : null;
}
