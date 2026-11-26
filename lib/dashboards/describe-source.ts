import type { SourceDescription } from "@openuidev/react-ui/cloud";

import { CATALOGS } from "@/lib/sources/catalog";

/** The query text each source's query tool takes, and what it's called. */
const QUERY_TEXT: Record<string, { label: string; arg: string }> = {
  postgres_query: { label: "SQL", arg: "sql" },
  mysql_query: { label: "SQL", arg: "sql" },
  clickhouse_query: { label: "SQL", arg: "sql" },
  bigquery_query: { label: "SQL", arg: "sql" },
  posthog_query: { label: "HogQL", arg: "hogql" },
};

/**
 * How a dashboard query reads in the Sources panel: the source's name (Postgres, GA4, …), and the
 * SQL or HogQL it runs. A tool with no query text shows its arguments, without the connection id.
 * Anything that isn't one of our source tools is left to the panel, which shows the call as is.
 */
export function describeSource(
  toolName: string,
  args: unknown,
): SourceDescription | undefined {
  const catalog = CATALOGS.find((candidate) =>
    toolName.startsWith(`${candidate.type}_`),
  );
  if (!catalog) return undefined;
  const { connection: _connection, ...rest } = isRecord(args) ? args : {};
  const text = QUERY_TEXT[toolName];
  if (text && typeof rest[text.arg] === "string") {
    return {
      kind: catalog.label,
      codeLabel: text.label,
      code: rest[text.arg] as string,
    };
  }
  if (toolName === "mcp_call" && typeof rest.tool === "string") {
    return {
      kind: catalog.label,
      codeLabel: rest.tool,
      code: JSON.stringify(rest.arguments ?? {}, null, 2),
    };
  }
  return {
    kind: catalog.label,
    codeLabel: "Request",
    code: JSON.stringify(rest, null, 2),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
