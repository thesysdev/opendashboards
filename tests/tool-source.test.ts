import { describe, expect, it } from "vitest";

import { ALL_SOURCES } from "@/lib/sources";
import { catalogFor, type ConnectionType } from "@/lib/sources/catalog";
import { sourceOfTool } from "@/lib/sources/tool-source";

describe("the source a tool's name points at", () => {
  const tools = ALL_SOURCES.flatMap((source) => source.tools.map((tool) => ({ type: source.type, name: tool.name })));

  it.each(tools.filter((tool) => tool.type !== "mcp"))("$name is $type's", ({ type, name }) => {
    expect(sourceOfTool(name)).toEqual({ type, label: catalogFor(type as ConnectionType).label, tile: catalogFor(type as ConnectionType).tile });
  });

  it.each(tools.filter((tool) => tool.type === "mcp"))("$name has no logo: the server behind it isn't in the name", ({ name }) => {
    expect(sourceOfTool(name)).toBeNull();
  });

  it("knows nothing about other tools", () => {
    for (const name of ["list_connections", "create_dashboard", "fetch_rows_v2", "local_retail_query", "posthog", "_query", ""]) {
      expect(sourceOfTool(name)).toBeNull();
    }
  });
});
