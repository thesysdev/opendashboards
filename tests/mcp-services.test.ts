import { describe, expect, it } from "vitest";

import { startMcpSignIn } from "@/lib/connections/mcp-sign-in";
import type { ConnectionService } from "@/lib/connections/service";
import { connectionConfigSchema } from "@/lib/sources/catalog";
import { ANY_MCP_SERVER, CATALOG_CATEGORIES, POPULAR, searchCatalog } from "@/lib/sources/directory";
import { mcpCatalog, mcpConfigSchema, normalizeMcpUrl } from "@/lib/sources/mcp/catalog";
import { MCP_SERVICES, MCP_SERVICE_KEYS } from "@/lib/sources/mcp/services";

import { workspaceOf } from "./orgs";

describe("known MCP servers", () => {
  it.each(MCP_SERVICE_KEYS)("%s has an https endpoint and at least one way to connect", (key) => {
    const service = MCP_SERVICES[key];
    expect(normalizeMcpUrl(service.url)).toBe(new URL(service.url).href);
    expect(service.auth.length).toBeGreaterThan(0);
    if ((service.auth as readonly string[]).includes("key")) expect("key" in service && service.key).toBeTruthy();
  });

  it("takes a preset's endpoint and header from the preset, whatever the form sent", () => {
    const parsed = mcpConfigSchema.parse({ service: "linear", url: "https://evil.example.com/mcp", headerName: "X-Steal" });
    expect(parsed).toEqual({ service: "linear", url: MCP_SERVICES.linear.url, headerName: "Authorization" });
  });

  it("refuses a service it doesn't know", () => {
    expect(mcpConfigSchema.safeParse({ service: "evil", url: "https://evil.example.com/mcp" }).success).toBe(false);
    expect(mcpConfigSchema.safeParse({ service: "__proto__", url: "https://evil.example.com/mcp" }).success).toBe(false);
  });

  it("refuses a key for a server that only supports signing in", () => {
    expect(mcpCatalog.configSchema.safeParse({ service: "sentry" }).success).toBe(false);
    expect(mcpCatalog.configSchema.safeParse({ service: "linear" }).success).toBe(true);
    expect(mcpCatalog.configSchema.safeParse({ service: "github" }).success).toBe(true);
  });

  it("still takes any server by URL", () => {
    expect(mcpCatalog.configSchema.parse({ url: "https://mcp.example.com/mcp" })).toEqual({ url: "https://mcp.example.com/mcp", headerName: "Authorization" });
  });

  it("reads configs saved before presets existed", () => {
    const old = { type: "mcp", url: "https://mcp.example.com/mcp", headerName: "Authorization" };
    expect(connectionConfigSchema.parse(old)).toEqual(old);
  });

  it("labels a preset's connections by the server's name", () => {
    expect(mcpCatalog.describe({ url: MCP_SERVICES.stripe.url, headerName: "Authorization", service: "stripe" })).toMatchObject({ source: "Stripe", tile: "ST" });
    expect(mcpCatalog.describe({ url: "https://mcp.example.com/mcp", headerName: "Authorization" })).toMatchObject({ source: "MCP server", tile: "MC" });
  });
});

describe("signing in to a known server", () => {
  // Every case here is refused before the service is touched.
  const service = {} as ConnectionService;

  it("refuses a server that only takes a key", async () => {
    const result = await startMcpSignIn(workspaceOf("user-1"), { name: "GitHub", service: "github" }, { service });
    expect(result).toMatchObject({ ok: false, error: { code: "validation" } });
  });

  it("refuses a URL sent along with a preset", async () => {
    const result = await startMcpSignIn(workspaceOf("user-1"), { name: "Linear", service: "linear", url: "https://evil.example.com/mcp" }, { service });
    expect(result).toMatchObject({ ok: false, error: { code: "validation" } });
  });
});

describe("the connector catalog", () => {
  const all = CATALOG_CATEGORIES.flatMap((category) => category.entries);

  it("lists each connector once, with no empty category", () => {
    expect(new Set(all.map((entry) => entry.key)).size).toBe(all.length);
    for (const category of CATALOG_CATEGORIES) expect(category.entries.length).toBeGreaterThan(0);
    expect(all.map((entry) => entry.key)).not.toContain(ANY_MCP_SERVER.key);
  });

  it("offers every known MCP server", () => {
    expect(all.filter((entry) => entry.open.kind === "mcp").map((entry) => entry.open.kind === "mcp" && entry.open.service).sort()).toEqual([...MCP_SERVICE_KEYS].sort());
  });

  it("only features connectors from the catalog", () => {
    for (const entry of POPULAR) expect(all).toContain(entry);
  });

  it("finds connectors by name and by what they hold", () => {
    expect(searchCatalog("lin").map((entry) => entry.label)).toEqual(["Linear"]);
    expect(searchCatalog("revenue").map((entry) => entry.label)).toContain("Stripe");
    expect(searchCatalog("  ")).toEqual([]);
    expect(searchCatalog("zzz")).toEqual([]);
  });
});
