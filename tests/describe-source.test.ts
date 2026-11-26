import { describe, expect, it } from "vitest";

import { describeSource } from "@/lib/dashboards/describe-source";

const connection = "8a1f2c3d-0000-4000-8000-000000000000";

describe("describeSource", () => {
  it("shows a SQL source's name and its SQL", () => {
    expect(
      describeSource("postgres_query", {
        connection,
        sql: "select 1",
        params: [],
      }),
    ).toEqual({
      kind: "Postgres",
      codeLabel: "SQL",
      code: "select 1",
    });
    expect(
      describeSource("bigquery_query", { connection, sql: "select 2" }),
    ).toMatchObject({ codeLabel: "SQL", code: "select 2" });
  });

  it("shows PostHog's HogQL", () => {
    expect(
      describeSource("posthog_query", {
        connection,
        hogql: "select count() from events",
      }),
    ).toEqual({
      kind: "PostHog",
      codeLabel: "HogQL",
      code: "select count() from events",
    });
  });

  it("shows an MCP call as the tool it calls and its arguments", () => {
    expect(
      describeSource("mcp_call", {
        connection,
        tool: "list_invoices",
        arguments: { limit: 5 },
      }),
    ).toMatchObject({
      codeLabel: "list_invoices",
      code: JSON.stringify({ limit: 5 }, null, 2),
    });
  });

  it("shows a report's request without the connection id", () => {
    const described = describeSource("ga4_report", {
      connection,
      startDate: "2026-01-01",
      endDate: "2026-01-31",
      metrics: [{ name: "sessions" }],
    });
    expect(described?.codeLabel).toBe("Request");
    expect(described?.code).not.toContain(connection);
    expect(JSON.parse(described?.code ?? "{}")).toEqual({
      startDate: "2026-01-01",
      endDate: "2026-01-31",
      metrics: [{ name: "sessions" }],
    });
  });

  it("leaves a tool that isn't one of our sources to the panel", () => {
    expect(describeSource("weather_lookup", { city: "Paris" })).toBeUndefined();
  });
});
