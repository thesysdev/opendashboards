import { CATALOGS } from "./catalog";

/**
 * Which source a tool belongs to, from its name alone, for showing the source's
 * logo beside the call. Client-safe.
 *
 * Every source names its tools `<type>_…` (posthog_query, postgres_tables,
 * ga4_report), so the part before the first underscore is the source's type.
 * tests/tool-source.test.ts checks that against every source's real tools.
 *
 * Null for anything else: list_connections, a tool this app doesn't know, and an
 * MCP server's tools. mcp_call reaches whatever server the connection points at
 * (Linear, Stripe, someone's own), which the name can't tell, so it gets no logo
 * rather than a wrong one.
 */
export function sourceOfTool(name: string): { type: string; label: string; tile: string } | null {
  const underscore = name.indexOf("_");
  const prefix = underscore > 0 ? name.slice(0, underscore) : "";
  if (!prefix || prefix === "mcp") return null;
  const catalog = CATALOGS.find((candidate) => candidate.type === prefix);
  return catalog ? { type: catalog.type, label: catalog.label, tile: catalog.tile } : null;
}
