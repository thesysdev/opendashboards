import { beforeEach, describe, expect, it, vi } from "vitest";

const started = vi.hoisted(() => ({ calls: [] as [string, unknown][], config: {} as Record<string, unknown> }));
vi.mock("@/lib/connections/composio-sign-in", () => ({
  startComposioSignIn: vi.fn(async (_scope: unknown, input: unknown) => {
    started.calls.push(["composio", input]);
    return { ok: true, data: { authorizationUrl: "https://composio.example/link", existing: null } };
  }),
}));
vi.mock("@/lib/connections/mcp-sign-in", () => ({
  startMcpSignIn: vi.fn(async (_scope: unknown, input: unknown) => {
    started.calls.push(["mcp", input]);
    return { ok: true, data: { authorizationUrl: "https://mcp.example/authorize", existing: null } };
  }),
}));
vi.mock("@/lib/connections", () => ({
  getConnectionService: () => ({
    forSignIn: async (_userId: string, id: string) => ({ ok: true, data: { id, orgId: "org-1", name: "Existing", config: started.config } }),
  }),
}));

import { startSignIn } from "@/lib/connections/sign-in";

const scope = { userId: "user-1", orgId: "org-1" };
const connectionId = "00000000-0000-4000-8000-000000000001";

describe("starting a sign-in", () => {
  beforeEach(() => {
    started.calls = [];
    started.config = {};
  });

  it("goes where its kind says, without the kind", async () => {
    await startSignIn(scope, { kind: "source", name: "Ads", source: "googleads", sharing: "personal" });
    await startSignIn(scope, { kind: "service", name: "Stripe", service: "stripe", sharing: "personal" });
    await startSignIn(scope, { kind: "url", name: "Ours", url: "https://mcp.example.com/mcp", sharing: "org" });
    expect(started.calls).toEqual([
      ["composio", { name: "Ads", source: "googleads", sharing: "personal" }],
      ["mcp", { name: "Stripe", service: "stripe", sharing: "personal" }],
      ["mcp", { name: "Ours", url: "https://mcp.example.com/mcp", sharing: "org" }],
    ]);
  });

  it("signs in to a connection that exists the way its own config says it was made", async () => {
    started.config = { type: "googleads", oauth: { provider: "composio" } };
    await startSignIn(scope, { kind: "connection", connectionId, returnTo: "/w/x" });
    started.config = { type: "mcp", url: "https://mcp.example.com/mcp", headerName: "Authorization", oauth: { issuer: "https://mcp.example.com" } };
    await startSignIn(scope, { kind: "connection", connectionId });
    expect(started.calls.map(([flow]) => flow)).toEqual(["composio", "mcp"]);
    expect(started.calls[0][1]).toEqual({ connectionId, returnTo: "/w/x" });
  });

  it("refuses a request that doesn't say what it's for, or a source that doesn't sign in", async () => {
    expect(await startSignIn(scope, { name: "Ads", source: "googleads", sharing: "personal" })).toMatchObject({ ok: false, error: { code: "validation" } });
    expect(await startSignIn(scope, { kind: "nonsense" })).toMatchObject({ ok: false, error: { code: "validation" } });
    expect(await startSignIn(scope, { kind: "source", name: "DB", source: "postgres", sharing: "org" })).toMatchObject({ ok: false, error: { code: "validation" } });
    expect(started.calls).toEqual([]);
  });
});
