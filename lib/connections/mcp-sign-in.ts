import "server-only";

import { z } from "zod";

import { config as appConfig } from "@/config";
import { track } from "@/lib/analytics";
import { logError } from "@/lib/log";
import type { Scope } from "@/lib/orgs/access";
import { mcpConfigSchema } from "@/lib/sources/mcp/catalog";
import { McpError } from "@/lib/sources/mcp/errors";
import { MCP_SERVICE_KEYS, mcpService, type McpServiceKey } from "@/lib/sources/mcp/services";
import {
  beginOAuthSignIn,
  discoverOAuth,
  exchangeOAuthCode,
  hashState,
  registerOAuthClient,
  writeOAuthCredential,
  type OAuthTestHooks,
  type PendingSignIn,
} from "@/lib/sources/mcp/oauth";

import { getConnectionService } from ".";
import { fail, fromCheckError, fromValidation, internalError, notFound, ok, type Result } from "./errors";
import { connectionNameSchema, RETURN_PATH } from "./schemas";
import type { ConnectionService } from "./service";

/**
 * Signing in to an MCP server with OAuth: start (discover the server's
 * authorization server, register, send the browser to sign in) and finish
 * (the callback: check it's this user's sign-in, swap the code for tokens,
 * test, save). Everything secret stays on the server.
 */

/** Where the authorization server sends the browser back. Exactly what's registered. */
export const mcpSignInRedirectUri = () => `${appConfig().appOrigin}/api/mcp/oauth/callback`;


/** How a new connection is used, fixed once added: each member signs in themselves unless it's shared. */
const sharing = z.enum(["personal", "org"]).default("personal");

const startSchema = z.union([
  z.object({ name: connectionNameSchema, url: z.string(), sharing }).strict(),
  // A known server: its endpoint comes from the preset, never the browser.
  z.object({ name: connectionNameSchema, service: z.enum(MCP_SERVICE_KEYS), sharing }).strict(),
  // Signing in to a connection that exists: as themselves, or (a shared one) as the one everyone runs as.
  z.object({ connectionId: z.uuid(), returnTo: z.string().regex(RETURN_PATH).optional() }).strict(),
]);

/** What a pending sign-in keeps sealed, besides the settings it will save. */
type PendingSecret = PendingSignIn & { requireIss: boolean; returnTo?: string };

type Deps = { service?: ConnectionService; testHooks?: OAuthTestHooks; redirectUri?: string };

/**
 * Starts a sign-in: to a new server in the member's org, or to a connection
 * that exists. Adding a server that already has a connection requiring
 * sign-in signs in to that one instead (`existing` names it). Returns where
 * to send the browser.
 */
export async function startMcpSignIn(
  scope: Scope,
  input: unknown,
  deps: Deps = {},
): Promise<Result<{ authorizationUrl: string; existing: string | null }>> {
  const { userId } = scope;
  const service = deps.service ?? getConnectionService();
  const parsed = startSchema.safeParse(input);
  if (!parsed.success) return fromValidation(parsed.error);

  let name: string;
  let url: string;
  let connectionId: string | null = null;
  let returnTo: string | undefined;
  let preset: McpServiceKey | undefined;
  let sharingOf: "personal" | "org" = "personal";
  let existing: string | null = null;
  let orgId = scope.orgId;
  if ("connectionId" in parsed.data) {
    ({ returnTo } = parsed.data);
    const found = await service.forSignIn(userId, parsed.data.connectionId);
    if (!found.ok) return found;
    if (found.data.config.type !== "mcp") return notFound();
    ({ name } = found.data);
    ({ url, service: preset } = found.data.config as { url: string; service?: McpServiceKey });
    connectionId = found.data.id;
    // In the workspace that connection is in, whichever one the caller has open.
    ({ orgId } = found.data);
  } else {
    if ("service" in parsed.data && !mcpService(parsed.data.service)?.auth.includes("oauth")) {
      return fail({ code: "validation", message: `${mcpService(parsed.data.service)?.label} doesn't support signing in. Use an API key.` });
    }
    const settings = mcpConfigSchema.safeParse("service" in parsed.data ? { service: parsed.data.service } : { url: parsed.data.url });
    if (!settings.success) return fromValidation(settings.error);
    ({ url, service: preset } = settings.data);
    ({ name, sharing: sharingOf } = parsed.data);
    // One connection per server that requires sign-in: everyone signs in to the same one.
    const already = sharingOf === "personal" ? await service.signInConnectionTo(scope, { url }) : null;
    if (already) {
      connectionId = already.id;
      ({ name } = already);
      existing = already.name;
    }
  }

  try {
    const redirectUri = deps.redirectUri ?? mcpSignInRedirectUri();
    const discovery = await discoverOAuth(url, deps.testHooks);
    const client = await registerOAuthClient(discovery, redirectUri, deps.testHooks);
    const started = await beginOAuthSignIn(discovery, client, redirectUri);
    const pending: PendingSecret = {
      ...started.pending,
      // RFC 9207: if the server says it sends `iss` back, a callback without it is refused.
      requireIss: (discovery.metadata as { authorization_response_iss_parameter_supported?: boolean }).authorization_response_iss_parameter_supported === true,
      returnTo,
    };
    const saved = await service.startSignIn(
      { userId, orgId },
      {
        stateHash: started.stateHash,
        connectionId,
        name,
        config: { type: "mcp", url, headerName: "Authorization", ...(preset && { service: preset }), oauth: discovery.settings },
        pending: JSON.stringify(pending),
        sharing: sharingOf,
      },
    );
    if (!saved.ok) return saved;
    return ok({ authorizationUrl: started.authorizationUrl.href, existing });
  } catch (error) {
    return failure("start", error);
  }
}

/** Where a sign-in started, to go back to however it ended. Null when it isn't known which sign-in it was. */
type StartedFrom = { orgId: string | null; returnTo: string | null };

/**
 * Finishes a sign-in from the callback's query parameters. Whether it worked
 * or not, `from` says where it started, once it's known which sign-in it was.
 */
export async function finishMcpSignIn(
  userId: string,
  params: URLSearchParams,
  deps: Deps = {},
): Promise<Result<{ id: string; orgId: string | null; returnTo: string | null }> & { from: StartedFrom | null }> {
  const service = deps.service ?? getConnectionService();
  const state = params.get("state");
  if (!state) {
    return { ...fail({ code: "oauth_failed", message: "The sign-in came back without its state, so it can't be trusted. Start again." }), from: null };
  }

  // Taken once, for this user only, before it expires: a replayed or someone else's callback finds nothing.
  const taken = await service.takeSignIn(userId, hashState(state));
  if (!taken) {
    return {
      ...fail({ code: "oauth_expired", message: "This sign-in expired or was already used. Start it again from Data Connections." }),
      from: null,
    };
  }
  const pending = JSON.parse(taken.pending) as PendingSecret;
  // Checked again on the way out: only our own app paths, ever.
  const from: StartedFrom = { orgId: taken.orgId, returnTo: pending.returnTo && RETURN_PATH.test(pending.returnTo) ? pending.returnTo : null };
  const result = await finishTaken(userId, params, taken, pending, service, deps);
  return { ...result, from };
}

async function finishTaken(
  userId: string,
  params: URLSearchParams,
  taken: NonNullable<Awaited<ReturnType<ConnectionService["takeSignIn"]>>>,
  pending: PendingSecret,
  service: ConnectionService,
  deps: Deps,
): Promise<Result<{ id: string; orgId: string | null; returnTo: string | null }>> {
  // How it ended, once it's known which sign-in this was. `renewal`: signing in again to a connection that exists.
  const finished = (outcome: "done" | "denied" | "failed", errorCode: string | null = null) =>
    track(
      userId,
      "connection_sign_in_finished",
      { source_type: taken.config.type, outcome, error_code: errorCode, renewal: taken.connectionId !== null },
      taken.orgId,
    );
  const serverError = params.get("error");
  if (serverError) {
    finished(serverError === "access_denied" ? "denied" : "failed", "server_error");
    const reason = serverError === "access_denied" ? "access was denied" : serverError;
    return fail({ code: "oauth_failed", message: `The server didn't sign you in (${reason.slice(0, 100)}).` });
  }
  const code = params.get("code");
  if (!code) {
    finished("failed", "no_code");
    return fail({ code: "oauth_failed", message: "The sign-in came back without a code. Start again." });
  }

  if (taken.config.type !== "mcp" || !taken.config.oauth) return internalError();
  const settings = taken.config.oauth;

  // RFC 9207: the response must come from the authorization server this sign-in went to.
  const iss = params.get("iss");
  if ((iss !== null && iss.replace(/\/+$/, "") !== settings.issuer.replace(/\/+$/, "")) || (iss === null && pending.requireIss)) {
    finished("failed", "oauth_invalid");
    return fail({ code: "oauth_invalid", message: "The sign-in came back from a different authorization server, so it was refused." });
  }

  try {
    const tokens = await exchangeOAuthCode(settings, pending, code, deps.testHooks);
    const credential = writeOAuthCredential({ kind: "oauth", client: pending.client, tokens });
    const saved = await service.saveSignedIn(userId, {
      orgId: taken.orgId,
      connectionId: taken.connectionId,
      sharing: taken.sharing,
      name: taken.name,
      config: taken.config,
      credential,
    });
    // Checked again on the way out: only our own app paths, ever.
    const back = pending.returnTo && RETURN_PATH.test(pending.returnTo) ? pending.returnTo : null;
    finished(saved.ok ? "done" : "failed", saved.ok ? null : saved.error.code);
    return saved.ok ? ok({ id: saved.data.id, orgId: taken.orgId, returnTo: back }) : saved;
  } catch (error) {
    const result = failure("finish", error);
    finished("failed", result.ok ? null : result.error.code);
    return result;
  }
}

function failure(step: string, error: unknown): Result<never> {
  const known = fromCheckError(error);
  if (known) return fail(known.error);
  if (error instanceof McpError) return fail({ code: error.code, message: "The sign-in didn't complete. Try again." });
  logError(`mcpSignIn.${step}`, error);
  return internalError();
}
