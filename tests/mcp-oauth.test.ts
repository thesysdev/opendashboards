import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync } from "node:fs";
import https from "node:https";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";

import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { finishMcpSignIn, startMcpSignIn } from "@/lib/connections/mcp-sign-in";
import { createConnectionService } from "@/lib/connections/service";
import { createDatabase } from "@/lib/db";
import { apps, connectionSignIns, dataConnections, mcpOAuthSignIns } from "@/lib/db/schema";
import { plaintextSecretBox } from "@/lib/secrets/plaintext";
import type { McpConfig } from "@/lib/sources/mcp/catalog";
import { McpError } from "@/lib/sources/mcp/errors";
import { discoverOAuth, readOAuthCredential, refreshOAuthTokens, writeOAuthCredential } from "@/lib/sources/mcp/oauth";
import { mcpSource, withCredential } from "@/lib/sources/mcp/source";
import type { ConnectionSource, OpenConnection } from "@/lib/sources/types";

import { TEST_DATABASE_URL } from "./global-setup";
import { workspaceOf, seedWorkspaces } from "./orgs";

/*
 * A fake authorization server and MCP resource server on https://127.0.0.1,
 * with a throwaway certificate. The test hooks only allow 127.0.0.1 and trust
 * that certificate; every other rule (HTTPS, no redirects, size caps, issuer
 * and resource checks, PKCE) is production's.
 */
const certDir = mkdtempSync(join(tmpdir(), "od-oauth-"));
execFileSync("openssl", [
  "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1", "-subj", "/CN=127.0.0.1",
  "-addext", "subjectAltName=IP:127.0.0.1",
  "-keyout", join(certDir, "key.pem"), "-out", join(certDir, "cert.pem"),
], { stdio: "ignore" });
const cert = readFileSync(join(certDir, "cert.pem"), "utf8");
const key = readFileSync(join(certDir, "key.pem"), "utf8");
const hooks = { allowAddress: (address: string) => address === "127.0.0.1", ca: cert };
const REDIRECT = "https://app.example.com/api/mcp/oauth/callback";

type Mode = {
  issuer?: string;
  pkce?: boolean;
  registration?: boolean;
  resource?: string;
  redirectMetadata?: boolean;
  refresh?: "ok" | "invalid_grant" | "down";
};
let mode: Mode = {};
let base = "";
const codes = new Map<string, { challenge: string; redirectUri: string; resource: string | null }>();
let refreshCalls = 0;
let issued = 0;
const live = new Set<string>();

let server: https.Server;

beforeAll(async () => {
  server = https.createServer({ cert, key }, (req, res) => {
    const url = new URL(req.url ?? "/", base);
    const json = (status: number, body: object) => res.writeHead(status, { "Content-Type": "application/json" }).end(JSON.stringify(body));
    if (url.pathname === "/mcp") {
      // An MCP server without a token: 401, naming the scope it needs and its metadata.
      return res
        .writeHead(401, { "WWW-Authenticate": `Bearer resource_metadata="${base}/.well-known/oauth-protected-resource/mcp", scope="read"` })
        .end();
    }
    if (url.pathname.startsWith("/.well-known/oauth-protected-resource")) {
      return json(200, { resource: mode.resource ?? `${base}/mcp`, authorization_servers: [base], scopes_supported: ["read", "write", "admin"] });
    }
    if (url.pathname === "/.well-known/oauth-authorization-server") {
      if (mode.redirectMetadata) return res.writeHead(302, { Location: "https://evil.example.com/meta" }).end();
      return json(200, {
        issuer: mode.issuer ?? base,
        authorization_endpoint: `${base}/authorize`,
        token_endpoint: `${base}/token`,
        ...(mode.registration === false ? {} : { registration_endpoint: `${base}/register` }),
        response_types_supported: ["code"],
        grant_types_supported: ["authorization_code", "refresh_token"],
        token_endpoint_auth_methods_supported: ["none"],
        ...(mode.pkce === false ? {} : { code_challenge_methods_supported: ["S256"] }),
        authorization_response_iss_parameter_supported: true,
      });
    }
    if (url.pathname.startsWith("/.well-known/")) return res.writeHead(404).end();
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      if (url.pathname === "/register") {
        const metadata = JSON.parse(body);
        return json(201, { client_id: "client-1", ...metadata });
      }
      if (url.pathname === "/token") {
        const form = new URLSearchParams(body);
        if (form.get("grant_type") === "authorization_code") {
          const entry = codes.get(form.get("code") ?? "");
          codes.delete(form.get("code") ?? "");
          const verifierHash = createHash("sha256").update(form.get("code_verifier") ?? "").digest("base64url");
          if (!entry || verifierHash !== entry.challenge || form.get("redirect_uri") !== entry.redirectUri || form.get("resource") !== entry.resource) {
            return json(400, { error: "invalid_grant", error_description: "bad code, verifier, redirect or resource" });
          }
          return json(200, tokens());
        }
        if (form.get("grant_type") === "refresh_token") {
          refreshCalls++;
          if (mode.refresh === "down") return json(503, { error: "temporarily_unavailable" });
          const presented = form.get("refresh_token") ?? "";
          if (mode.refresh === "invalid_grant" || !live.has(presented)) return json(400, { error: "invalid_grant", error_description: "expired" });
          live.delete(presented); // rotation: each refresh token works once
          return json(200, tokens());
        }
      }
      res.writeHead(404).end();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `https://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

function tokens() {
  issued++;
  const refresh = `rt-${issued}`;
  live.add(refresh);
  return { access_token: `at-${issued}`, refresh_token: refresh, token_type: "Bearer", expires_in: 3600 };
}

/** What the authorization server does when the user approves: a code bound to the PKCE challenge. */
function approve(authorizationUrl: string) {
  const url = new URL(authorizationUrl);
  const code = `code-${codes.size + 1}-${Math.random().toString(36).slice(2)}`;
  codes.set(code, {
    challenge: url.searchParams.get("code_challenge") ?? "",
    redirectUri: url.searchParams.get("redirect_uri") ?? "",
    resource: url.searchParams.get("resource"),
  });
  return new URLSearchParams({ code, state: url.searchParams.get("state") ?? "", iss: base });
}

const { db, pool } = createDatabase(TEST_DATABASE_URL);
const service = createConnectionService({
  db,
  secrets: () => plaintextSecretBox,
  // Signed in, so the check would reach the server; it's the sign-in under test here.
  sources: () => ({ ...mcpSource, test: async () => [] }) as unknown as ConnectionSource,
});
const deps = { service, testHooks: hooks, redirectUri: REDIRECT };

beforeEach(async () => {
  mode = {};
  await db.execute(sql`TRUNCATE ${apps}, ${dataConnections}, ${mcpOAuthSignIns} CASCADE`);
  await seedWorkspaces(db, ["alice", "mallory"]);
});
afterAll(() => pool.end());

describe("discovery", () => {
  it("finds the authorization server and records what refreshing needs", async () => {
    const { settings } = await discoverOAuth(`${base}/mcp`, hooks);
    // Only the scope the server's 401 asks for, not every scope it lists ("read write admin").
    expect(settings).toMatchObject({ issuer: base, tokenEndpoint: `${base}/token`, resource: `${base}/mcp`, scope: "read" });
  });

  it.each<[string, Mode, string]>([
    ["names another issuer", { issuer: "https://127.0.0.1:1" }, "oauth_invalid"],
    ["doesn't support PKCE S256", { pkce: false }, "oauth_invalid"],
    ["describes another server as the resource", { resource: "https://other.example.com/mcp" }, "oauth_invalid"],
    ["redirects its metadata", { redirectMetadata: true }, "redirected"],
  ])("refuses an authorization server that %s", async (_label, setup, code) => {
    mode = setup;
    const error = await discoverOAuth(`${base}/mcp`, hooks).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(McpError);
    expect([code, "oauth_failed"]).toContain((error as McpError).code);
    if (code !== "redirected") expect((error as McpError).code).toBe(code);
  });

  it("refuses private addresses with the production rules", async () => {
    for (const host of ["127.0.0.1", "169.254.169.254", "[::1]"]) {
      const error = await discoverOAuth(`https://${host}/mcp`).catch((e: unknown) => e);
      expect((error as McpError).code).toBe("host_blocked");
    }
  });
});

describe("signing in", () => {
  it("starts with PKCE and the resource, finishes for the same user, and stores tokens sealed", async () => {
    const started = await startMcpSignIn(workspaceOf("alice"), { name: "Linear", url: `${base}/mcp` }, deps);
    if (!started.ok) throw new Error(started.error.code);
    const authorize = new URL(started.data.authorizationUrl);
    expect(authorize.origin + authorize.pathname).toBe(`${base}/authorize`);
    expect(authorize.searchParams.get("code_challenge_method")).toBe("S256");
    expect(authorize.searchParams.get("resource")).toBe(`${base}/mcp`);
    expect(authorize.searchParams.get("redirect_uri")).toBe(REDIRECT);

    // The pending sign-in is keyed by a hash of the state, and its secrets are sealed.
    const [pending] = await db.select().from(mcpOAuthSignIns);
    expect(pending.stateHash).not.toBe(authorize.searchParams.get("state"));
    expect(JSON.stringify(pending.config)).not.toContain("code_verifier");

    const finished = await finishMcpSignIn("alice", approve(started.data.authorizationUrl), deps);
    expect(finished).toMatchObject({ ok: true });
    const [row] = await db.select().from(dataConnections);
    // Requires sign-in unless chosen otherwise; the tokens are Alice's own sign-in to it, never on the connection.
    expect(row).toMatchObject({ userId: "alice", type: "mcp", sharing: "personal", secret: null, credentialHint: "signed in" });
    expect((row.config as McpConfig).oauth).toMatchObject({ issuer: base, resource: `${base}/mcp` });
    const [signIn] = await db.select().from(connectionSignIns);
    expect(signIn).toMatchObject({ connectionId: row.id, userId: "alice", status: "ok" });
    const credential = readOAuthCredential(await plaintextSecretBox.open(signIn.secret, { purpose: "", userId: "", connectionId: "" }));
    expect(credential.tokens).toMatchObject({ access_token: "at-" + issued, refresh_token: "rt-" + issued });
    expect(await db.select().from(mcpOAuthSignIns)).toHaveLength(0);
  });

  it("can't be finished twice", async () => {
    const started = await startMcpSignIn(workspaceOf("alice"), { name: "Linear", url: `${base}/mcp` }, deps);
    if (!started.ok) throw new Error(started.error.code);
    const params = approve(started.data.authorizationUrl);
    expect(await finishMcpSignIn("alice", params, deps)).toMatchObject({ ok: true });
    expect(await finishMcpSignIn("alice", params, deps)).toMatchObject({ ok: false, error: { code: "oauth_expired" } });
  });

  it("can't be finished by another user, and the owner still can", async () => {
    const started = await startMcpSignIn(workspaceOf("alice"), { name: "Linear", url: `${base}/mcp` }, deps);
    if (!started.ok) throw new Error(started.error.code);
    const params = approve(started.data.authorizationUrl);
    expect(await finishMcpSignIn("mallory", params, deps)).toMatchObject({ ok: false, error: { code: "oauth_expired" } });
    expect(await db.select().from(dataConnections)).toHaveLength(0);
    expect(await finishMcpSignIn("alice", params, deps)).toMatchObject({ ok: true });
    expect((await db.select().from(dataConnections))[0]?.userId).toBe("alice");
  });

  it("expires", async () => {
    const quick = createConnectionService({ db, secrets: () => plaintextSecretBox, sources: () => mcpSource as unknown as ConnectionSource, signInTtlMs: 1 });
    const started = await startMcpSignIn(workspaceOf("alice"), { name: "Linear", url: `${base}/mcp` }, { ...deps, service: quick });
    if (!started.ok) throw new Error(started.error.code);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(await finishMcpSignIn("alice", approve(started.data.authorizationUrl), deps)).toMatchObject({ ok: false, error: { code: "oauth_expired" } });
  });

  it("refuses a callback from another authorization server, or without iss when it's promised", async () => {
    for (const iss of ["https://evil.example.com", null]) {
      const started = await startMcpSignIn(workspaceOf("alice"), { name: "Linear", url: `${base}/mcp` }, deps);
      if (!started.ok) throw new Error(started.error.code);
      const params = approve(started.data.authorizationUrl);
      if (iss) params.set("iss", iss);
      else params.delete("iss");
      expect(await finishMcpSignIn("alice", params, deps)).toMatchObject({ ok: false, error: { code: "oauth_invalid" } });
    }
    expect(await db.select().from(dataConnections)).toHaveLength(0);
  });

  it("uses up the sign-in when the user declines", async () => {
    const started = await startMcpSignIn(workspaceOf("alice"), { name: "Linear", url: `${base}/mcp` }, deps);
    if (!started.ok) throw new Error(started.error.code);
    const state = new URL(started.data.authorizationUrl).searchParams.get("state") ?? "";
    const declined = new URLSearchParams({ error: "access_denied", state });
    expect(await finishMcpSignIn("alice", declined, deps)).toMatchObject({ ok: false, error: { code: "oauth_failed" } });
    expect(await db.select().from(mcpOAuthSignIns)).toHaveLength(0);
  });

  it("says where a declined sign-in started, to go back there (N-9)", async () => {
    const APP = `/w/${workspaceOf("alice").orgId}/apps/0f8fad5b-d9cb-469f-a165-70867728950e`;
    const first = await startMcpSignIn(workspaceOf("alice"), { name: "Linear", url: `${base}/mcp` }, deps);
    if (!first.ok) throw new Error(first.error.code);
    const created = await finishMcpSignIn("alice", approve(first.data.authorizationUrl), deps);
    if (!created.ok) throw new Error(created.error.code);
    const again = await startMcpSignIn(workspaceOf("alice"), { connectionId: created.data.id, returnTo: APP }, deps);
    if (!again.ok) throw new Error(again.error.code);
    const state = new URL(again.data.authorizationUrl).searchParams.get("state") ?? "";
    expect(await finishMcpSignIn("alice", new URLSearchParams({ error: "access_denied", state }), deps)).toMatchObject({
      ok: false,
      from: { orgId: workspaceOf("alice").orgId, returnTo: APP },
    });
    // A callback that matches no sign-in of theirs says nothing about where it came from.
    expect(await finishMcpSignIn("alice", new URLSearchParams({ error: "access_denied", state }), deps)).toMatchObject({ ok: false, from: null });
  });

  it("signs in to the workspace's connection to the same server instead of adding another", async () => {
    const first = await startMcpSignIn(workspaceOf("alice"), { name: "Linear", url: `${base}/mcp` }, deps);
    if (!first.ok) throw new Error(first.error.code);
    expect(first.data.existing).toBeNull();
    const created = await finishMcpSignIn("alice", approve(first.data.authorizationUrl), deps);
    if (!created.ok) throw new Error(created.error.code);

    const second = await startMcpSignIn(workspaceOf("alice"), { name: "Linear again", url: `${base}/mcp` }, deps);
    if (!second.ok) throw new Error(second.error.code);
    expect(second.data.existing).toBe("Linear");
    expect(await finishMcpSignIn("alice", approve(second.data.authorizationUrl), deps)).toMatchObject({ ok: true, data: { id: created.data.id } });
    expect(await db.select().from(dataConnections)).toHaveLength(1);
    expect(await db.select().from(connectionSignIns)).toHaveLength(1);
  });

  it("adds a sign-in shared with the workspace when asked to", async () => {
    const started = await startMcpSignIn(workspaceOf("alice"), { name: "Linear", url: `${base}/mcp`, sharing: "org" }, deps);
    if (!started.ok) throw new Error(started.error.code);
    expect(await finishMcpSignIn("alice", approve(started.data.authorizationUrl), deps)).toMatchObject({ ok: true });
    expect((await db.select().from(dataConnections))[0]).toMatchObject({ sharing: "org", secret: null });
  });

  it("says when a server can't register OpenDashboards automatically", async () => {
    mode = { registration: false };
    expect(await startMcpSignIn(workspaceOf("alice"), { name: "GitHub", url: `${base}/mcp` }, deps)).toMatchObject({
      ok: false,
      error: { code: "oauth_unsupported" },
    });
  });

  it("signs in again to an existing connection, keeping its id", async () => {
    const first = await startMcpSignIn(workspaceOf("alice"), { name: "Linear", url: `${base}/mcp` }, deps);
    if (!first.ok) throw new Error(first.error.code);
    const created = await finishMcpSignIn("alice", approve(first.data.authorizationUrl), deps);
    if (!created.ok) throw new Error(created.error.code);
    const again = await startMcpSignIn(workspaceOf("alice"), { connectionId: created.data.id }, deps);
    if (!again.ok) throw new Error(again.error.code);
    expect(await finishMcpSignIn("alice", approve(again.data.authorizationUrl), deps)).toMatchObject({ ok: true, data: { id: created.data.id } });
    expect(await db.select().from(dataConnections)).toHaveLength(1);
    // Someone else's connection can't be signed in to again.
    expect(await startMcpSignIn(workspaceOf("mallory"), { connectionId: created.data.id }, deps)).toMatchObject({ ok: false, error: { code: "not_found" } });
  });
});

describe("coming back to where the sign-in started", () => {
  const APP = "/w/3b241101-e2bb-4255-8caf-4136c566a962/apps/0f8fad5b-d9cb-469f-a165-70867728950e/7c9e6679-7425-40de-944b-e07fc1f90ae7";

  it("returns to the dashboard it was started from", async () => {
    const first = await startMcpSignIn(workspaceOf("alice"), { name: "Linear", url: `${base}/mcp` }, deps);
    if (!first.ok) throw new Error(first.error.code);
    const created = await finishMcpSignIn("alice", approve(first.data.authorizationUrl), deps);
    if (!created.ok) throw new Error(created.error.code);
    expect(created.data.returnTo).toBeNull();

    const again = await startMcpSignIn(workspaceOf("alice"), { connectionId: created.data.id, returnTo: APP }, deps);
    if (!again.ok) throw new Error(again.error.code);
    expect(await finishMcpSignIn("alice", approve(again.data.authorizationUrl), deps)).toMatchObject({ ok: true, data: { returnTo: APP } });
  });

  it.each([
    "https://evil.example.com/apps/x",
    "//evil.example.com",
    "/connections",
    "/w/3b241101-e2bb-4255-8caf-4136c566a962/connections",
    "/w/3b241101-e2bb-4255-8caf-4136c566a962/apps/../connections",
    "/w/not-an-id/apps/0f8fad5b-d9cb-469f-a165-70867728950e",
    // The address before workspaces were in it.
    "/apps/0f8fad5b-d9cb-469f-a165-70867728950e",
    `${APP}?next=https://evil.example.com`,
  ])(
    "refuses %j as a place to return to",
    async (returnTo) => {
      expect(await startMcpSignIn(workspaceOf("alice"), { connectionId: "0f8fad5b-d9cb-469f-a165-70867728950e", returnTo }, deps)).toMatchObject({
        ok: false,
        error: { code: "validation" },
      });
    },
  );
});

describe("refreshing", () => {
  async function signedIn(): Promise<OpenConnection<McpConfig>> {
    const started = await startMcpSignIn(workspaceOf("alice"), { name: "Linear", url: `${base}/mcp` }, deps);
    if (!started.ok) throw new Error(started.error.code);
    const finished = await finishMcpSignIn("alice", approve(started.data.authorizationUrl), deps);
    if (!finished.ok) throw new Error(finished.error.code);
    return (await service.open("alice", finished.data.id, "mcp")) as OpenConnection<McpConfig>;
  }

  /** Makes the stored access token look about to expire. */
  async function expireSoon(connection: OpenConnection<McpConfig>) {
    await connection.updateCredential!(async (current) => {
      const credential = readOAuthCredential(current);
      return { credential: writeOAuthCredential({ ...credential, tokens: { ...credential.tokens!, expires_at: Date.now() + 1_000 } }) };
    });
    return (await service.open("alice", connection.id, "mcp")) as OpenConnection<McpConfig>;
  }

  it("refreshes a token about to expire before using it", async () => {
    const connection = await expireSoon(await signedIn());
    const used: string[] = [];
    await withCredential(connection, async (target) => used.push(target.credential), hooks);
    expect(used).toEqual([`at-${issued}`]);
    expect(readOAuthCredential((await service.open("alice", connection.id, "mcp"))!.credential).tokens?.access_token).toBe(`at-${issued}`);
  });

  it("refreshes once when two queries need it at the same time (rotating refresh tokens survive)", async () => {
    const connection = await expireSoon(await signedIn());
    const before = refreshCalls;
    const tokensSeen: string[] = [];
    await Promise.all(
      [1, 2, 3].map(async () => {
        const fresh = (await service.open("alice", connection.id, "mcp")) as OpenConnection<McpConfig>;
        await withCredential(fresh, async (target) => tokensSeen.push(target.credential), hooks);
      }),
    );
    expect(refreshCalls - before).toBe(1);
    expect(new Set(tokensSeen).size).toBe(1);
    const stored = (await db.select().from(connectionSignIns).where(eq(connectionSignIns.connectionId, connection.id)))[0];
    expect(stored.status).toBe("ok");
  });

  describe("Test again", () => {
    // A source whose plain check would fail with the expired token, as a real server would.
    const retesting = createConnectionService({
      db,
      secrets: () => plaintextSecretBox,
      sources: () =>
        ({
          ...mcpSource,
          test: async () => {
            throw new McpError("key_rejected");
          },
          retest: (connection: OpenConnection<McpConfig>) => withCredential(connection, async () => {}, hooks).then(() => []),
        }) as unknown as ConnectionSource,
    });
    const statusOf = async (id: string) => (await db.select().from(connectionSignIns).where(eq(connectionSignIns.connectionId, id)))[0].status;

    it("renews an expired access token instead of marking a working sign-in invalid", async () => {
      const connection = await expireSoon(await signedIn());
      const before = refreshCalls;
      expect(await retesting.retest("alice", { id: connection.id })).toEqual({ ok: true, data: { status: "ok" } });
      expect(refreshCalls - before).toBe(1);
      expect(await statusOf(connection.id)).toBe("ok");
    });

    it("still marks a sign-in whose refresh is refused for signing in again", async () => {
      const connection = await expireSoon(await signedIn());
      mode = { refresh: "invalid_grant" };
      expect(await retesting.retest("alice", { id: connection.id })).toMatchObject({ ok: false, error: { code: "reauth_required" } });
      expect(await statusOf(connection.id)).toBe("invalid");
    });
  });

  it("retries once with a refreshed token after a 401", async () => {
    const connection = await signedIn();
    let attempts = 0;
    const result = await withCredential(
      connection,
      async (target) => {
        attempts++;
        if (attempts === 1) throw new McpError("key_rejected");
        return target.credential;
      },
      hooks,
    );
    expect(attempts).toBe(2);
    expect(result).toBe(`at-${issued}`);
  });

  it("marks the connection for signing in again when the refresh token is refused, and drops the tokens", async () => {
    const connection = await expireSoon(await signedIn());
    mode = { refresh: "invalid_grant" };
    const error = await withCredential(connection, async () => "unused", hooks).catch((e: unknown) => e);
    expect((error as McpError).code).toBe("reauth_required");
    const [row] = await db.select().from(connectionSignIns);
    expect(row).toMatchObject({ status: "invalid" });
    expect(readOAuthCredential((await service.open("alice", connection.id, "mcp"))!.credential).tokens).toBeNull();
    expect(mcpSource.toError(error)).toMatchObject({ status: "invalid", error: { code: "reauth_required" } });
  });

  it("changes nothing when the token endpoint is only down", async () => {
    const connection = await expireSoon(await signedIn());
    const before = readOAuthCredential(connection.credential).tokens;
    mode = { refresh: "down" };
    const error = await withCredential(connection, async () => "unused", hooks).catch((e: unknown) => e);
    expect((error as McpError).code).not.toBe("reauth_required");
    const [row] = await db.select().from(connectionSignIns);
    expect(row.status).toBe("ok");
    expect(readOAuthCredential((await service.open("alice", connection.id, "mcp"))!.credential).tokens?.refresh_token).toBe(before?.refresh_token);
  });

  it("refreshes rotate the refresh token, and a spent one is refused", async () => {
    const connection = await signedIn();
    const credential = readOAuthCredential(connection.credential);
    const settings = connection.config.oauth!;
    const next = await refreshOAuthTokens(settings, credential, hooks);
    expect(next.refresh_token).not.toBe(credential.tokens?.refresh_token);
    const reused = await refreshOAuthTokens(settings, credential, hooks).catch((e: unknown) => e);
    expect((reused as McpError).code).toBe("reauth_required");
  });
});
