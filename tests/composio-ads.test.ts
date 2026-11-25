import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { finishComposioSignIn, startComposioSignIn } from "@/lib/connections/composio-sign-in";
import { createConnectionService } from "@/lib/connections/service";
import { createDatabase } from "@/lib/db";
import { apps, connectionSignIns, dataConnections, mcpOAuthSignIns } from "@/lib/db/schema";
import { plaintextSecretBox } from "@/lib/secrets/plaintext";
import { ComposioError, createSignInLink, runTool, type ComposioDeps } from "@/lib/sources/composio/client";
import { composioToError, flattenRows, readComposioCredential } from "@/lib/sources/composio/shared";
import { gaqlSchema, googleAdsDeps, googleAdsSource, withLimit } from "@/lib/sources/googleads/source";
import { googleAdsCatalog } from "@/lib/sources/googleads/catalog";
import { metaAdsCatalog } from "@/lib/sources/metaads/catalog";
import { metaAdsDeps, metaAdsSource } from "@/lib/sources/metaads/source";
import type { ConnectionSource } from "@/lib/sources/types";

import { TEST_DATABASE_URL } from "./global-setup";
import { seedWorkspaces, workspaceOf } from "./orgs";

/** A fake Composio: records requests, answers from `respond`. */
function fakeComposio(respond: (path: string, init: RequestInit) => { status?: number; body: unknown }) {
  const calls: { path: string; method: string; headers: Record<string, string>; body: unknown }[] = [];
  const deps: ComposioDeps = {
    apiKey: "test-key",
    authConfigId: "ac_test",
    fetch: (async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input));
      calls.push({ path: url.pathname, method: init?.method ?? "GET", headers: init?.headers as Record<string, string>, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      expect(init?.redirect).toBe("error");
      const { status = 200, body } = respond(url.pathname, init ?? {});
      return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
    }) as typeof fetch,
  };
  return { deps, calls };
}

const account = { composioUserId: "od-user", connectedAccountId: "ca_123" };
const signal = new AbortController().signal;

describe("the Composio client", () => {
  it("runs a tool as the account, with our key, and returns its data", async () => {
    const { deps, calls } = fakeComposio(() => ({ body: { successful: true, error: null, data: { results: [{ a: 1 }] } } }));
    const data = await runTool("googleads", "GOOGLEADS_SEARCH_STREAM_GAQL", account, { query: "SELECT 1" }, signal, deps);
    expect(data).toEqual({ results: [{ a: 1 }] });
    expect(calls[0]).toMatchObject({
      path: "/api/v3.1/tools/execute/GOOGLEADS_SEARCH_STREAM_GAQL",
      method: "POST",
      headers: { "x-api-key": "test-key" },
      body: { connected_account_id: "ca_123", user_id: "od-user", version: "20261116_00", arguments: { query: "SELECT 1" } },
    });
  });

  it("reads data Composio sends as a JSON string", async () => {
    const { deps } = fakeComposio(() => ({ body: { successful: true, error: null, data: '{"resourceNames":["customers/1"]}' } }));
    expect(await runTool("googleads", "GOOGLEADS_LIST_ACCESSIBLE_CUSTOMERS", account, {}, signal, deps)).toEqual({ resourceNames: ["customers/1"] });
  });

  it("tells a lost sign-in from a bad query, a rate limit and our own key being refused", async () => {
    const cases: [{ status?: number; body: unknown }, string][] = [
      [{ body: { successful: false, error: "Connected account ca_123 is expired", data: {} } }, "reauth_required"],
      [{ body: { successful: false, error: "Unrecognized field in the query: 'metrics.foo'", data: {} } }, "bad_request"],
      [{ body: { successful: false, error: "RESOURCE_EXHAUSTED: too many requests", data: {} } }, "rate_limited"],
      [{ status: 401, body: { error: { message: "Invalid API key" } } }, "project_rejected"],
      [{ status: 404, body: { error: { message: "Connected account not found" } } }, "reauth_required"],
      // A 404 on a tool run without account wording is a wrong tool or version, ours to fix: nobody is asked to sign in again.
      [{ status: 404, body: { error: { message: "Tool not found" } } }, "unexpected"],
      [{ status: 503, body: {} }, "unavailable"],
    ];
    for (const [answer, code] of cases) {
      const { deps } = fakeComposio(() => answer);
      await expect(runTool("metaads", "METAADS_GET_INSIGHTS", account, {}, signal, deps)).rejects.toMatchObject({ code, toolkit: "metaads" });
    }
  });

  it("starts a sign-in on the auth config, for this Composio user, coming back to our callback", async () => {
    const { deps, calls } = fakeComposio(() => ({ status: 201, body: { redirect_url: "https://connect.composio.dev/link/abc", connected_account_id: "ca_9", link_token: "t", expires_at: "x" } }));
    const link = await createSignInLink("metaads", { composioUserId: "od-1", callbackUrl: "https://app.example.com/api/composio/callback/s" }, deps);
    expect(link).toEqual({ redirectUrl: "https://connect.composio.dev/link/abc", connectedAccountId: "ca_9" });
    expect(calls[0]?.body).toEqual({ auth_config_id: "ac_test", user_id: "od-1", callback_url: "https://app.example.com/api/composio/callback/s" });
  });

  it("refuses a sign-in link that isn't https", async () => {
    const { deps } = fakeComposio(() => ({ status: 201, body: { redirect_url: "javascript:alert(1)", connected_account_id: "ca_9" } }));
    await expect(createSignInLink("googleads", { composioUserId: "od-1", callbackUrl: "https://x/cb" }, deps)).rejects.toMatchObject({ code: "unexpected" });
  });

  it("says when Composio isn't set up", async () => {
    await expect(createSignInLink("googleads", { composioUserId: "od-1", callbackUrl: "https://x/cb" }, { apiKey: "k", authConfigId: "" })).rejects.toMatchObject({
      code: "not_configured",
    });
  });
});

describe("Google Ads stays read-only", () => {
  it("only runs one GAQL SELECT", () => {
    expect(gaqlSchema.safeParse("SELECT campaign.name FROM campaign").success).toBe(true);
    expect(gaqlSchema.safeParse("  select metrics.clicks from campaign").success).toBe(true);
    expect(gaqlSchema.safeParse("MUTATE campaign SET status = PAUSED").success).toBe(false);
    expect(gaqlSchema.safeParse("SELECT campaign.name FROM campaign; SELECT 1").success).toBe(false);
  });

  it("limits rows: the query's own LIMIT when smaller, never more than the cap", () => {
    expect(withLimit("SELECT campaign.name FROM campaign", 200)).toBe("SELECT campaign.name FROM campaign LIMIT 201");
    expect(withLimit("SELECT campaign.name FROM campaign LIMIT 5", 200)).toBe("SELECT campaign.name FROM campaign LIMIT 5");
    expect(withLimit("SELECT campaign.name FROM campaign LIMIT 50000", 200)).toBe("SELECT campaign.name FROM campaign LIMIT 201");
  });

  it("calls only Composio tools that only read", async () => {
    const called = new Set<string>();
    const fake = fakeComposio((path) => {
      called.add(path.split("/").pop() ?? "");
      return { body: { successful: true, error: null, data: { results: [], resourceNames: ["customers/1234567"], data: [] } } };
    });
    const connection = { id: "c", name: "Ads", config: { oauth: { provider: "composio" as const } }, credential: JSON.stringify(account) };
    const realFetch = globalThis.fetch;
    globalThis.fetch = fake.deps.fetch!;
    process.env.COMPOSIO_API_KEY = "test-key";
    try {
      for (const source of [googleAdsSource, metaAdsSource] as unknown as ConnectionSource[]) {
        for (const tool of source.tools) {
          const args =
            tool.name === "googleads_query"
              ? { customerId: "1234567", query: "SELECT campaign.name FROM campaign" }
              : tool.name === "googleads_fields"
                ? { prefix: "campaign" }
                : tool.name === "metaads_insights"
                  ? { objectId: "act_1234567", level: "campaign", fields: ["spend"] }
                  : tool.name === "metaads_campaigns"
                    ? { adAccountId: "act_1234567" }
                    : {};
          await tool.execute(connection, args, { signal, caller: "agent" });
        }
      }
    } finally {
      globalThis.fetch = realFetch;
      delete process.env.COMPOSIO_API_KEY;
    }
    // Each one tagged readOnlyHint by Composio (checked against its tool list for version 20261116_00).
    expect([...called].sort()).toEqual([
      "GOOGLEADS_LIST_ACCESSIBLE_CUSTOMERS",
      "GOOGLEADS_SEARCH_GOOGLE_ADS_FIELDS",
      "GOOGLEADS_SEARCH_STREAM_GAQL",
      "METAADS_GET_AD_ACCOUNTS",
      "METAADS_GET_INSIGHTS",
      "METAADS_LIST_CAMPAIGNS",
    ]);
  });

  it("can't be added by pasting a credential: only by signing in", () => {
    for (const source of [googleAdsSource, metaAdsSource]) {
      expect(source.credential.schema.safeParse(JSON.stringify(account)).success).toBe(false);
    }
  });
});

describe("rows", () => {
  it("flattens Google Ads rows and reads metrics as numbers, ids as text", () => {
    const result = flattenRows(
      [
        { campaign: { id: "12345678901", name: "Brand" }, segments: { date: "2026-11-01" }, metrics: { clicks: "12", costMicros: "3400000" } },
        { campaign: { id: "12345678902", name: "Generic" }, segments: { date: "2026-11-01" }, metrics: { clicks: "7", costMicros: "1200000" } },
      ],
      (column) => column.startsWith("metrics."),
      1,
    );
    expect(result).toEqual({
      columns: ["campaign.id", "campaign.name", "segments.date", "metrics.clicks", "metrics.costMicros"],
      rows: [{ "campaign.id": "12345678901", "campaign.name": "Brand", "segments.date": "2026-11-01", "metrics.clicks": 12, "metrics.costMicros": 3400000 }],
      truncated: true,
    });
  });

  it("turns Meta's actions into a column per action type", () => {
    const result = flattenRows(
      [{ campaign_name: "Sale", publisher_platform: "instagram", spend: "152.40", actions: [{ action_type: "purchase", value: "3" }, { action_type: "link_click", value: "40" }] }],
      (column) => !column.endsWith("_name"),
      10,
    );
    expect(result.rows[0]).toEqual({ campaign_name: "Sale", publisher_platform: "instagram", spend: 152.4, "actions.purchase": 3, "actions.link_click": 40 });
  });
});

describe("errors", () => {
  it("each source names itself, and a lost sign-in asks to sign in again", () => {
    const lost = new ComposioError("reauth_required", "expired", "metaads");
    expect(composioToError(googleAdsCatalog, lost)).toBeNull();
    // An error that doesn't say which source it's from isn't claimed, rather than named after the wrong one.
    expect(composioToError(googleAdsCatalog, new ComposioError("unavailable"))).toBeNull();
    expect(composioToError(metaAdsCatalog, lost)).toEqual({
      status: "invalid",
      error: { code: "reauth_required", message: "The sign-in to Meta Ads expired or was revoked. Sign in again from Data Connections." },
    });
    expect(googleAdsSource.toError(new ComposioError("bad_request", "Unrecognized field 'metrics.foo'", "googleads"))?.error.message).toContain("metrics.foo");
  });
});

describe("signing in through Composio", () => {
  const { db, pool } = createDatabase(TEST_DATABASE_URL);
  const service = createConnectionService({
    db,
    secrets: () => plaintextSecretBox,
    // The sources' own checks run against the fake Composio below: they decide whose account it is.
    sources: (type) => (type === "metaads" ? metaAdsSource : googleAdsSource) as unknown as ConnectionSource,
  });

  let accountState: { status: string; user_id: string; toolkit: string } = { status: "ACTIVE", user_id: "", toolkit: "googleads" };
  let deleted: string[] = [];
  const composio = fakeComposio((path, init) => {
    if (path.endsWith("/connected_accounts/link")) {
      const body = JSON.parse(String(init.body)) as { user_id: string };
      accountState.user_id ||= body.user_id;
      return { status: 201, body: { redirect_url: "https://connect.composio.dev/link/abc", connected_account_id: "ca_new", link_token: "t", expires_at: "x" } };
    }
    if (init.method === "DELETE") {
      deleted.push(path.split("/").pop() ?? "");
      return { body: {} };
    }
    if (path.endsWith("/revoke")) return { body: {} };
    return { body: { id: "ca_new", status: accountState.status, user_id: accountState.user_id, toolkit: { slug: accountState.toolkit } } };
  });
  const deps = { service, composio: composio.deps, pollMs: 1 };
  // Releasing a sign-in goes to the fake too, never the real Composio.
  googleAdsDeps.composio = composio.deps;
  metaAdsDeps.composio = composio.deps;

  beforeEach(async () => {
    accountState = { status: "ACTIVE", user_id: "", toolkit: "googleads" };
    deleted = [];
    await db.execute(sql`TRUNCATE ${apps}, ${dataConnections}, ${mcpOAuthSignIns} CASCADE`);
    await seedWorkspaces(db, ["alice", "mallory"]);
  });

  afterAll(async () => {
    await pool.end();
  });

  const stateOf = (url: string) => new URL(url).pathname.split("/").pop() ?? null;

  async function start(source: "googleads" | "metaads" = "googleads") {
    const started = await startComposioSignIn(workspaceOf("alice"), { name: "Ads", source }, deps);
    if (!started.ok) throw new Error(started.error.code);
    const link = composio.calls.findLast((call) => call.path.endsWith("/connected_accounts/link"))?.body as { callback_url: string };
    return { started, state: stateOf(link.callback_url) ?? "" };
  }

  it("sends the browser to Composio, then saves a sign-in connection for the account it started", async () => {
    const { started, state } = await start();
    expect(started.data.authorizationUrl).toBe("https://connect.composio.dev/link/abc");

    const finished = await finishComposioSignIn("alice", state, deps);
    if (!finished.ok) throw new Error(finished.error.code);
    const [row] = await db.select().from(dataConnections).where(eq(dataConnections.id, finished.data.id));
    expect(row).toMatchObject({ type: "googleads", sharing: "personal", name: "Ads", config: { type: "googleads", oauth: { provider: "composio" } } });
    const [signIn] = await db.select().from(connectionSignIns).where(and(eq(connectionSignIns.connectionId, finished.data.id), eq(connectionSignIns.userId, "alice")));
    // The account it started, never the one named in the callback's URL.
    expect(readComposioCredential(await plaintextSecretBox.open(signIn!.secret, { purpose: "", userId: "", connectionId: "" }))).toEqual({ composioUserId: accountState.user_id, connectedAccountId: "ca_new" });
  });

  it("adding the same source again signs in to the workspace's connection, like an MCP server", async () => {
    const first = await start();
    const done = await finishComposioSignIn("alice", first.state, deps);
    if (!done.ok) throw new Error(done.error.code);

    accountState.user_id = "";
    const again = await startComposioSignIn(workspaceOf("alice"), { name: "Ads again", source: "googleads" }, deps);
    expect(again).toMatchObject({ ok: true, data: { existing: "Ads" } });
    const link = composio.calls.findLast((call) => call.path.endsWith("/connected_accounts/link"))?.body as { callback_url: string };
    const finished = await finishComposioSignIn("alice", stateOf(link.callback_url), deps);
    expect(finished).toMatchObject({ ok: true, data: { id: done.data.id } });
    expect(await db.select().from(dataConnections)).toHaveLength(1);

    // A shared connection is its own: it isn't one each person signs in to.
    accountState.user_id = "";
    expect(await startComposioSignIn(workspaceOf("alice"), { name: "Team ads", source: "googleads", sharing: "org" }, deps)).toMatchObject({
      ok: true,
      data: { existing: null },
    });
    // Another source is another connection.
    expect(await startComposioSignIn(workspaceOf("alice"), { name: "Meta", source: "metaads" }, deps)).toMatchObject({ ok: true, data: { existing: null } });
  });

  it("comes back to a path that carries the state, whatever Composio appends", async () => {
    await start();
    const link = composio.calls.findLast((call) => call.path.endsWith("/connected_accounts/link"))?.body as { callback_url: string };
    expect(link.callback_url).toMatch(/^http:\/\/localhost:\d+\/api\/composio\/callback\/[A-Za-z0-9_-]{43}$/);
    expect(await finishComposioSignIn("alice", "not-a-state", deps)).toMatchObject({ ok: false, error: { code: "oauth_failed" } });
  });

  it("lets go of the Composio account when the connection is removed or signed out of", async () => {
    for (const leave of ["remove", "signOut"] as const) {
      deleted = [];
      const { state } = await start();
      const finished = await finishComposioSignIn("alice", state, deps);
      if (!finished.ok) throw new Error(finished.error.code);
      const result = await service[leave]("alice", { id: finished.data.id });
      expect(result.ok).toBe(true);
      expect(deleted).toEqual(["ca_new"]);
      accountState = { status: "ACTIVE", user_id: "", toolkit: "googleads" };
    }
  });

  it("can't be finished twice, or by someone else", async () => {
    const { state } = await start();
    const mallory = await finishComposioSignIn("mallory", state, deps);
    expect(mallory).toMatchObject({ ok: false, error: { code: "oauth_expired" } });
    const alice = await finishComposioSignIn("alice", state, deps);
    expect(alice.ok).toBe(true);
    const again = await finishComposioSignIn("alice", state, deps);
    expect(again).toMatchObject({ ok: false, error: { code: "oauth_expired" } });
  });

  it("saves nothing, and removes the account, when the sign-in didn't complete", async () => {
    accountState.status = "FAILED";
    const { state } = await start();
    const finished = await finishComposioSignIn("alice", state, deps);
    expect(finished).toMatchObject({ ok: false, error: { code: "oauth_failed" } });
    expect(await db.select().from(dataConnections)).toEqual([]);
    expect(deleted).toEqual(["ca_new"]);
  });

  it("refuses an account that belongs to another Composio user or another platform", async () => {
    for (const change of [{ user_id: "od-someone-else" }, { toolkit: "metaads" }]) {
      const { state } = await start();
      Object.assign(accountState, change);
      const finished = await finishComposioSignIn("alice", state, deps);
      expect(finished.ok).toBe(false);
      accountState = { status: "ACTIVE", user_id: "", toolkit: "googleads" };
    }
    expect(await db.select().from(dataConnections)).toEqual([]);
    await vi.waitFor(() => expect(deleted).toContain("ca_new"));
  });

  it("lets go of the Composio account of a sign-in that expired before the browser came back", async () => {
    await start();
    await db.update(mcpOAuthSignIns).set({ expiresAt: new Date(Date.now() - 1_000) });
    deleted = [];
    // The next sign-in to start sweeps it, with its account.
    await start("metaads");
    await vi.waitFor(() => expect(deleted).toEqual(["ca_new"]));
    expect(await db.select().from(mcpOAuthSignIns)).toHaveLength(1);
  });

  it("lets go of unfinished sign-ins deleted with a member, through the source", async () => {
    await start();
    const [row] = await db.select().from(mcpOAuthSignIns);
    await service.releaseDeleted({ signIns: [], pending: [row!] });
    expect(deleted).toEqual(["ca_new"]);
  });
});
