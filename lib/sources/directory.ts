import { SOURCE_OPTIONS, type SourceOption } from "./catalog";
import { MCP_SERVICES, type McpServiceKey } from "./mcp/services";

/**
 * The connector catalog on Data Connections: every source and known MCP
 * server, grouped by what people build dashboards about. Client-safe.
 *
 * A known MCP server is a preset on the MCP connector; "Any MCP server" is
 * the connector itself. A native source wins over an MCP server for the same
 * product.
 */

export type CatalogEntry = {
  key: string;
  label: string;
  blurb: string;
  tile: string;
  open: { kind: "source"; source: Pick<SourceOption, "type" | "flavor"> } | { kind: "mcp"; service: McpServiceKey };
};

function source(key: string): CatalogEntry {
  const option = SOURCE_OPTIONS.find((candidate) => candidate.key === key);
  if (!option) throw new Error(`Unknown source: ${key}`);
  return { key, label: option.label, blurb: option.blurb, tile: option.tile, open: { kind: "source", source: option } };
}

function mcp(service: McpServiceKey): CatalogEntry {
  const { label, blurb, tile } = MCP_SERVICES[service];
  return { key: `mcp:${service}`, label, blurb, tile, open: { kind: "mcp", service } };
}

/** The generic MCP connector: any remote server, typed in. */
export const ANY_MCP_SERVER = source("mcp");

export const CATALOG_CATEGORIES: { key: string; label: string; entries: CatalogEntry[] }[] = [
  {
    key: "databases",
    label: "Databases and warehouses",
    entries: [source("postgres"), source("supabase"), source("neon"), source("mysql"), source("clickhouse"), source("bigquery")],
  },
  { key: "product", label: "Product analytics", entries: [source("posthog"), mcp("amplitude"), mcp("mixpanel")] },
  { key: "marketing", label: "Web, SEO and marketing", entries: [source("ga4"), source("searchconsole"), source("googleads"), source("metaads")] },
  { key: "revenue", label: "Sales and revenue", entries: [mcp("stripe"), mcp("attio")] },
  { key: "support", label: "Support", entries: [mcp("intercom")] },
  { key: "engineering", label: "Engineering", entries: [mcp("linear"), mcp("jira"), mcp("github"), mcp("sentry")] },
];

const ALL = CATALOG_CATEGORIES.flatMap((category) => category.entries);

export const POPULAR_KEYS = ["postgres", "posthog", "ga4", "searchconsole", "mcp:stripe", "mcp:linear"];
export const POPULAR: CatalogEntry[] = POPULAR_KEYS.map((key) => {
  const entry = ALL.find((candidate) => candidate.key === key);
  if (!entry) throw new Error(`Unknown catalog entry: ${key}`);
  return entry;
});

/** Entries whose name or blurb matches every word typed, in catalog order. "Any MCP server" always matches nothing: it's shown on its own. */
export function searchCatalog(query: string): CatalogEntry[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  return ALL.filter((entry) => {
    const text = `${entry.label} ${entry.blurb}`.toLowerCase();
    return words.every((word) => text.includes(word));
  });
}
