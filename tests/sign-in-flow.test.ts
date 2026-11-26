import { beforeEach, describe, expect, it, vi } from "vitest";

const mcp = vi.hoisted(() => ({ calls: [] as unknown[] }));
vi.mock("@/lib/connections/mcp-sign-in", () => ({
  startMcpSignIn: vi.fn(async (_scope: unknown, input: unknown) => {
    mcp.calls.push(input);
    return { ok: true, data: { authorizationUrl: "https://mcp.example/authorize", existing: null } };
  }),
}));
vi.mock("@/lib/connections", () => ({ getConnectionService: () => ({}) }));
// Run what's handed to waitUntil now, so the test can see it.
vi.mock("@vercel/functions", () => ({ waitUntil: (promise: Promise<unknown>) => promise }));

import { finishSignIn, startNewSignIn, startSignInTo } from "@/lib/connections/sign-in";
import type { ConnectionService } from "@/lib/connections/service";
import type { ConnectionType } from "@/lib/sources/catalog";
import { SignInRefused } from "@/lib/sources/sign-in";
import type { ConnectionSource, SourceSignIn } from "@/lib/sources/types";

const scope = { userId: "user-1", orgId: "org-1" };
const connectionId = "00000000-0000-4000-8000-000000000001";
const STATE = "a".repeat(43);
const DASHBOARD = `/w/${connectionId}/apps/${connectionId}`;

/** A source that signs in on its own page, recording what it was asked. */
function signingInSource() {
  const calls = { started: [] as unknown[], finished: [] as unknown[], discarded: [] as string[] };
  let finish: () => Promise<string> = async () => "credential";
  const signIn: SourceSignIn<Record<string, unknown>> = {
    start: async (input) => {
      calls.started.push(input);
      return { url: "https://source.example/sign-in", pending: "pending-1" };
    },
    finish: async (input) => {
      calls.finished.push(input);
      return finish();
    },
    discard: async (pending) => void calls.discarded.push(pending),
  };
  return { calls, signIn, finishWith: (next: () => Promise<string>) => (finish = next) };
}

describe("the shared sign-in flow", () => {
  let source: ReturnType<typeof signingInSource>;
  let service: { [K in "forSignIn" | "startSignIn" | "takeSignIn" | "saveSignedIn"]: ReturnType<typeof vi.fn> };
  let deps: { service: ConnectionService; sources: (type: ConnectionType) => ConnectionSource };

  beforeEach(() => {
    mcp.calls = [];
    source = signingInSource();
    service = {
      forSignIn: vi.fn(),
      startSignIn: vi.fn(async () => ({ ok: true, data: undefined })),
      takeSignIn: vi.fn(),
      saveSignedIn: vi.fn(async () => ({ ok: true, data: { id: connectionId, warnings: [] } })),
    };
    deps = {
      service: service as unknown as ConnectionService,
      // Google Ads signs in; Postgres connects with a key.
      sources: (type) => ({ label: type, ...(type === "googleads" && { signIn: source.signIn }) }) as unknown as ConnectionSource,
    };
  });

  it("starts a new connection on the source's own sign-in page, coming back to the shared callback", async () => {
    const started = await startNewSignIn(scope, { type: "googleads", name: "Ads", sharing: "personal" }, deps);
    expect(started).toEqual({ ok: true, data: { authorizationUrl: "https://source.example/sign-in" } });
    const [{ config, state, callbackUrl }] = source.calls.started as { config: unknown; state: string; callbackUrl: string }[];
    expect(config).toEqual({ oauth: { provider: "composio" } });
    expect(callbackUrl).toMatch(new RegExp(`/api/sign-in/callback/${state}$`));
    expect(service.startSignIn).toHaveBeenCalledWith(scope, expect.objectContaining({
      connectionId: null,
      name: "Ads",
      sharing: "personal",
      config: { type: "googleads", oauth: { provider: "composio" } },
      pending: "pending-1",
    }));
  });

  it("refuses a source that connects with a key, before starting anything", async () => {
    expect(await startNewSignIn(scope, { type: "postgres", name: "DB" }, deps)).toMatchObject({ ok: false, error: { code: "validation" } });
    expect(await startNewSignIn(scope, { name: "Ads" }, deps)).toMatchObject({ ok: false, error: { code: "validation" } });
    expect(source.calls.started).toEqual([]);
    expect(service.startSignIn).not.toHaveBeenCalled();
  });

  it("lets go of what the source made when the sign-in isn't allowed to start", async () => {
    service.startSignIn.mockResolvedValueOnce({ ok: false, error: { code: "forbidden", message: "No." } });
    expect(await startNewSignIn(scope, { type: "googleads", name: "Ads" }, deps)).toMatchObject({ ok: false, error: { code: "forbidden" } });
    await vi.waitFor(() => expect(source.calls.discarded).toEqual(["pending-1"]));
  });

  it("signs in to a connection that exists through its own source, in its own workspace", async () => {
    service.forSignIn.mockResolvedValueOnce({ ok: true, data: { id: connectionId, orgId: "org-2", name: "Ads", config: { type: "googleads", oauth: { provider: "composio" } } } });
    expect(await startSignInTo(scope, { connectionId, returnTo: DASHBOARD }, deps)).toMatchObject({ ok: true });
    expect(service.startSignIn).toHaveBeenCalledWith({ userId: "user-1", orgId: "org-2" }, expect.objectContaining({ connectionId, name: "Ads", returnTo: DASHBOARD }));
  });

  it("sends MCP servers to their own sign-in, for now", async () => {
    await startNewSignIn(scope, { type: "mcp", name: "Linear", service: "linear", sharing: "org" }, deps);
    service.forSignIn.mockResolvedValueOnce({ ok: true, data: { id: connectionId, orgId: "org-1", name: "Linear", config: { type: "mcp", url: "https://mcp.example.com/mcp", headerName: "Authorization", oauth: {} } } });
    await startSignInTo(scope, { connectionId, returnTo: DASHBOARD }, deps);
    expect(mcp.calls).toEqual([{ name: "Linear", sharing: "org", service: "linear" }, { connectionId, returnTo: DASHBOARD }]);
    expect(source.calls.started).toEqual([]);
  });

  describe("finishing", () => {
    const taken = {
      orgId: "org-1",
      connectionId: null,
      sharing: "personal",
      name: "Ads",
      config: { type: "googleads", oauth: { provider: "composio" } },
      pending: "pending-1",
      returnTo: null,
    };

    it("saves what the source's sign-in got", async () => {
      service.takeSignIn.mockResolvedValueOnce(taken);
      const params = new URLSearchParams({ status: "success" });
      const finished = await finishSignIn("user-1", STATE, params, deps);
      expect(finished).toMatchObject({ ok: true, data: { id: connectionId }, from: { orgId: "org-1", returnTo: null } });
      expect(source.calls.finished).toEqual([{ config: { oauth: { provider: "composio" } }, pending: "pending-1", params }]);
      expect(service.saveSignedIn).toHaveBeenCalledWith("user-1", expect.objectContaining({ credential: "credential", name: "Ads" }));
      expect(source.calls.discarded).toEqual([]);
    });

    it("saves nothing, and lets go of what the source made, when the sign-in didn't complete or can't be saved", async () => {
      service.takeSignIn.mockResolvedValue(taken);
      source.finishWith(async () => {
        throw new SignInRefused("denied", "account_expired");
      });
      expect(await finishSignIn("user-1", STATE, new URLSearchParams(), deps)).toMatchObject({ ok: false, error: { code: "oauth_failed" } });
      expect(service.saveSignedIn).not.toHaveBeenCalled();

      source.finishWith(async () => "credential");
      service.saveSignedIn.mockResolvedValueOnce({ ok: false, error: { code: "limit", message: "Full." } });
      expect(await finishSignIn("user-1", STATE, new URLSearchParams(), deps)).toMatchObject({ ok: false, error: { code: "limit" } });
      await vi.waitFor(() => expect(source.calls.discarded).toEqual(["pending-1", "pending-1"]));
    });

    it("finds nothing for a state it couldn't have made, or one already taken", async () => {
      expect(await finishSignIn("user-1", "not-a-state", new URLSearchParams(), deps)).toMatchObject({ ok: false, error: { code: "oauth_failed" }, from: null });
      service.takeSignIn.mockResolvedValueOnce(null);
      expect(await finishSignIn("user-1", STATE, new URLSearchParams(), deps)).toMatchObject({ ok: false, error: { code: "oauth_expired" }, from: null });
      expect(source.calls.finished).toEqual([]);
    });
  });
});
