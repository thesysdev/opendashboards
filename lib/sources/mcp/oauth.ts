import "server-only";

import { createHash, randomBytes } from "node:crypto";

import {
  discoverOAuthServerInfo,
  exchangeAuthorization,
  extractWWWAuthenticateParams,
  refreshAuthorization,
  registerClient,
  selectResourceURL,
  startAuthorization,
  type OAuthClientProvider,
} from "@modelcontextprotocol/sdk/client/auth.js";
import { InvalidClientError, InvalidGrantError, OAuthError, UnauthorizedClientError } from "@modelcontextprotocol/sdk/server/auth/errors.js";
import type { AuthorizationServerMetadata, OAuthClientInformationMixed, OAuthTokens } from "@modelcontextprotocol/sdk/shared/auth.js";
import { LATEST_PROTOCOL_VERSION } from "@modelcontextprotocol/sdk/types.js";

import { config as appConfig } from "@/config";
import { createGuardedFetch, type GuardedFetchTestHooks } from "@/lib/net/guarded-fetch";

import type { McpOAuthSettings } from "./catalog";
import { McpError, toMcpError } from "./errors";

/**
 * OAuth for remote MCP servers (the MCP authorization spec), as a client of
 * the user's server. The protocol steps are the official SDK's; this module
 * adds what the SDK leaves to the app, and checks it doesn't do:
 *
 * - Every request (discovery, registration, token) goes through the guarded
 *   fetch: HTTPS, public addresses only, never ours, no redirects, capped.
 * - The authorization server's metadata must name the issuer it was fetched
 *   for (RFC 8414 §3.3), every endpoint must be HTTPS, and PKCE S256 must be
 *   supported. The protected-resource metadata must be for this server.
 * - The sign-in URL must point at the discovered authorization endpoint.
 * - Tokens are only ever sent as a bearer token to the server they're for.
 */

/** The credential stored for a signed-in MCP connection, sealed like any other. */
export type McpOAuthCredential = {
  kind: "oauth";
  /** The client registration: its id, and a secret if the server issued one. */
  client: OAuthClientInformationMixed;
  /** null once a sign-in has expired: the user signs in again. */
  tokens: StoredTokens | null;
};

export type StoredTokens = {
  access_token: string;
  token_type: string;
  refresh_token?: string;
  scope?: string;
  /** Milliseconds since the epoch, when the server said. */
  expires_at?: number;
};

export function readOAuthCredential(credential: string): McpOAuthCredential {
  const parsed = JSON.parse(credential) as Partial<McpOAuthCredential>;
  if (parsed.kind !== "oauth" || !parsed.client || typeof parsed.client.client_id !== "string") {
    throw new McpError("unexpected", "Stored OAuth credential is malformed");
  }
  return { kind: "oauth", client: parsed.client, tokens: parsed.tokens ?? null };
}

export const writeOAuthCredential = (credential: McpOAuthCredential) => JSON.stringify(credential);

/** Whether the access token needs refreshing before use. */
export function needsRefresh(tokens: StoredTokens | null, now = Date.now()): boolean {
  if (!tokens) return false;
  return tokens.expires_at !== undefined && tokens.expires_at - now < appConfig().mcp.oauthRefreshMarginMs;
}

function storedTokens(tokens: OAuthTokens, previous?: StoredTokens | null): StoredTokens {
  return {
    access_token: tokens.access_token,
    token_type: tokens.token_type,
    // A server that doesn't rotate refresh tokens leaves the old one in force.
    refresh_token: tokens.refresh_token ?? previous?.refresh_token,
    scope: tokens.scope ?? previous?.scope,
    expires_at: typeof tokens.expires_in === "number" ? Date.now() + tokens.expires_in * 1000 : undefined,
  };
}

/** Tests only: reach a local authorization server. */
export type OAuthTestHooks = GuardedFetchTestHooks;

/** Discovery and registration: the next host comes from the previous answer. Never carries a credential. */
const oauthFetch = (testHooks?: OAuthTestHooks) =>
  createGuardedFetch({ origin: "any-https", maxBytes: 256 * 1024, timeoutMs: appConfig().mcp.requestTimeoutMs }, testHooks);

/** Code exchange and refresh carry the code, refresh token and client secret: only ever to the token endpoint's origin. */
const tokenFetch = (settings: McpOAuthSettings, testHooks?: OAuthTestHooks) =>
  createGuardedFetch(
    { origin: new URL(settings.tokenEndpoint).origin, maxBytes: 256 * 1024, timeoutMs: appConfig().mcp.requestTimeoutMs },
    testHooks,
  );

const isHttps = (value: string | undefined, testHooks?: OAuthTestHooks) => {
  if (!value) return false;
  try {
    const url = new URL(value);
    return (url.protocol === "https:" || (testHooks?.allowHttp === true && url.protocol === "http:")) && !url.username && !url.password;
  } catch {
    return false;
  }
};

/** "https://as.example.com" and "https://as.example.com/" are the same issuer. */
const sameIssuer = (a: string, b: string) => a.replace(/\/+$/, "") === b.replace(/\/+$/, "");

/** What a sign-in needs to know about a server, all validated. */
export type OAuthDiscovery = {
  settings: McpOAuthSettings;
  metadata: AuthorizationServerMetadata;
};

/** Finds and checks the server's authorization server. */
export async function discoverOAuth(serverUrl: string, testHooks?: OAuthTestHooks): Promise<OAuthDiscovery> {
  const fetchFn = oauthFetch(testHooks);
  try {
    const challenge = await challengeOf(serverUrl, testHooks);
    const info = await discoverOAuthServerInfo(serverUrl, { fetchFn, resourceMetadataUrl: challenge.resourceMetadataUrl });
    const metadata = info.authorizationServerMetadata;
    if (!metadata) throw new McpError("oauth_unsupported", "The server doesn't publish OAuth sign-in details.");

    // RFC 8414 §3.3: the metadata must be for the server it was asked about.
    if (!sameIssuer(metadata.issuer, info.authorizationServerUrl)) {
      throw new McpError("oauth_invalid", `The authorization server's metadata names another issuer (${metadata.issuer}).`);
    }
    for (const [name, endpoint] of [
      ["authorization", metadata.authorization_endpoint],
      ["token", metadata.token_endpoint],
    ] as const) {
      if (!isHttps(endpoint, testHooks)) throw new McpError("oauth_invalid", `The ${name} endpoint isn't an https:// URL.`);
    }
    const revocationEndpoint = (metadata as { revocation_endpoint?: string }).revocation_endpoint;
    for (const endpoint of [metadata.registration_endpoint, revocationEndpoint]) {
      if (endpoint !== undefined && !isHttps(endpoint, testHooks)) throw new McpError("oauth_invalid", "An OAuth endpoint isn't an https:// URL.");
    }
    if (!metadata.code_challenge_methods_supported?.includes("S256")) {
      throw new McpError("oauth_invalid", "The authorization server doesn't support PKCE (S256), which MCP requires.");
    }

    // The protected-resource metadata must be for this server (the SDK checks the URL).
    let resource = serverUrl;
    if (info.resourceMetadata) {
      await selectResourceURL(serverUrl, {} as OAuthClientProvider, info.resourceMetadata);
      resource = info.resourceMetadata.resource;
    }
    // Least privilege: only the scope the server's own challenge asks for. Without
    // one, none: the authorization server applies its default. Never every scope it lists.
    const scope = challenge.scope || undefined;

    return {
      metadata,
      settings: {
        issuer: metadata.issuer,
        tokenEndpoint: metadata.token_endpoint,
        tokenAuthMethods: metadata.token_endpoint_auth_methods_supported,
        revocationEndpoint,
        resource,
        scope,
      },
    };
  } catch (error) {
    throw toOAuthError(error);
  } finally {
    await fetchFn.close();
  }
}

/**
 * What the server says when called without a token: its 401's WWW-Authenticate
 * names the scope it needs and where its protected-resource metadata is. Sent
 * to the server's own origin only, with no credential.
 */
async function challengeOf(serverUrl: string, testHooks?: OAuthTestHooks): Promise<{ scope?: string; resourceMetadataUrl?: URL }> {
  const probe = createGuardedFetch(
    { origin: new URL(serverUrl).origin, maxBytes: 64 * 1024, timeoutMs: appConfig().mcp.requestTimeoutMs },
    testHooks,
  );
  try {
    const response = await probe(serverUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", "User-Agent": "OpenDashboards" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: { protocolVersion: LATEST_PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: "OpenDashboards", version: "1.0.0" } },
      }),
    });
    await response.body?.cancel().catch(() => {});
    if (response.status !== 401) return {};
    const { scope, resourceMetadataUrl } = extractWWWAuthenticateParams(response);
    return { scope, resourceMetadataUrl };
  } catch {
    // No challenge to read: discovery falls back to the well-known URLs.
    return {};
  } finally {
    await probe.close();
  }
}

/** Registers OpenDashboards with the authorization server (dynamic client registration). */
export async function registerOAuthClient(
  discovery: OAuthDiscovery,
  redirectUri: string,
  testHooks?: OAuthTestHooks,
): Promise<OAuthClientInformationMixed> {
  if (!discovery.metadata.registration_endpoint) {
    throw new McpError("oauth_unsupported", "This server needs an app registered with it by hand, which OpenDashboards doesn't support yet.");
  }
  const fetchFn = oauthFetch(testHooks);
  const register = (method: "none" | "client_secret_post") =>
    registerClient(discovery.settings.issuer, {
      metadata: discovery.metadata,
      clientMetadata: {
        client_name: "OpenDashboards",
        redirect_uris: [redirectUri],
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        token_endpoint_auth_method: method,
        scope: discovery.settings.scope,
      },
      fetchFn,
    });
  try {
    // A public client with PKCE first; some servers only register confidential clients.
    return await register("none").catch(() => register("client_secret_post"));
  } catch (error) {
    throw toOAuthError(error);
  } finally {
    await fetchFn.close();
  }
}

/** The values a started sign-in keeps on the server until the callback. */
export type PendingSignIn = { codeVerifier: string; client: OAuthClientInformationMixed; redirectUri: string };

/** Starts a sign-in: the URL to send the browser to, and what to keep until it comes back. */
export async function beginOAuthSignIn(
  discovery: OAuthDiscovery,
  client: OAuthClientInformationMixed,
  redirectUri: string,
): Promise<{ state: string; stateHash: string; authorizationUrl: URL; pending: PendingSignIn }> {
  const state = randomBytes(32).toString("base64url");
  const { authorizationUrl, codeVerifier } = await startAuthorization(discovery.settings.issuer, {
    metadata: discovery.metadata,
    clientInformation: client,
    redirectUrl: redirectUri,
    scope: discovery.settings.scope,
    state,
    // Sent verbatim, as the metadata states it.
    resource: discovery.settings.resource,
  });
  // The browser only ever goes to the authorization endpoint the server's metadata named.
  const endpoint = new URL(discovery.metadata.authorization_endpoint);
  if (authorizationUrl.origin !== endpoint.origin || authorizationUrl.pathname !== endpoint.pathname) {
    throw new McpError("oauth_invalid", "The sign-in URL doesn't match the authorization server.");
  }
  return { state, stateHash: hashState(state), authorizationUrl, pending: { codeVerifier, client, redirectUri } };
}

/** Pending sign-ins are found by a hash of their state, never the state itself. */
export const hashState = (state: string) => createHash("sha256").update(state).digest("hex");

/** The token endpoint's details, as stored, in the shape the SDK takes. */
const metadataOf = (settings: McpOAuthSettings) =>
  ({
    issuer: settings.issuer,
    authorization_endpoint: settings.issuer,
    token_endpoint: settings.tokenEndpoint,
    response_types_supported: ["code"],
    token_endpoint_auth_methods_supported: settings.tokenAuthMethods,
    code_challenge_methods_supported: ["S256"],
  }) as AuthorizationServerMetadata;

/** Swaps the callback's code for tokens. */
export async function exchangeOAuthCode(
  settings: McpOAuthSettings,
  pending: PendingSignIn,
  code: string,
  testHooks?: OAuthTestHooks,
): Promise<StoredTokens> {
  const fetchFn = tokenFetch(settings, testHooks);
  try {
    const tokens = await exchangeAuthorization(settings.issuer, {
      metadata: metadataOf(settings),
      clientInformation: pending.client,
      authorizationCode: code,
      codeVerifier: pending.codeVerifier,
      redirectUri: pending.redirectUri,
      resource: settings.resource,
      fetchFn,
    });
    return storedTokens(tokens);
  } catch (error) {
    throw toOAuthError(error);
  } finally {
    await fetchFn.close();
  }
}

/**
 * Gets a new access token. A refusal (the refresh token expired or was
 * revoked, or the client registration is gone) means signing in again;
 * anything else (the server down) is temporary and changes nothing stored.
 */
export async function refreshOAuthTokens(
  settings: McpOAuthSettings,
  credential: McpOAuthCredential,
  testHooks?: OAuthTestHooks,
): Promise<StoredTokens> {
  const refreshToken = credential.tokens?.refresh_token;
  if (!refreshToken) throw new McpError("reauth_required", "The sign-in expired and the server gave no way to renew it.");
  const fetchFn = tokenFetch(settings, testHooks);
  try {
    const tokens = await refreshAuthorization(settings.issuer, {
      metadata: metadataOf(settings),
      clientInformation: credential.client,
      refreshToken,
      resource: settings.resource,
      fetchFn,
    });
    return storedTokens(tokens, credential.tokens);
  } catch (error) {
    throw toOAuthError(error);
  } finally {
    await fetchFn.close();
  }
}

/** OAuth failures, by what the user can do about them. */
function toOAuthError(error: unknown): McpError {
  if (error instanceof McpError) return error;
  if (error instanceof InvalidGrantError || error instanceof InvalidClientError || error instanceof UnauthorizedClientError) {
    return new McpError("reauth_required", error.message.slice(0, 300));
  }
  if (error instanceof OAuthError) {
    // The server is having trouble: nothing stored changes, try again later.
    if (error.errorCode === "server_error" || error.errorCode === "temporarily_unavailable") {
      return new McpError("unavailable", `${error.errorCode}: ${error.message}`.slice(0, 300));
    }
    return new McpError("oauth_failed", `${error.errorCode}: ${error.message}`.slice(0, 300));
  }
  const message = error instanceof Error ? error.message : String(error);
  if (/resource/i.test(message) && /match|allowed/i.test(message)) return new McpError("oauth_invalid", message.slice(0, 300));
  // Network and guard failures (blocked host, redirect, too large, timeout) read as they do for MCP calls.
  const network = toMcpError(error, { hasKey: false });
  if (network.code !== "unexpected") return network;
  return new McpError("oauth_failed", message.slice(0, 300));
}
