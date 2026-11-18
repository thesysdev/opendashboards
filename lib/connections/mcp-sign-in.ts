import "server-only";

import { z } from "zod";

import { config as appConfig } from "@/config";
import { logError } from "@/lib/log";
import { mcpConfigSchema } from "@/lib/sources/mcp/catalog";
import { McpError } from "@/lib/sources/mcp/errors";
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
import { connectionNameSchema } from "./schemas";
import type { ConnectionService } from "./service";

/**
 * Signing in to an MCP server with OAuth: start (discover the server's
 * authorization server, register, send the browser to sign in) and finish
 * (the callback: check it's this user's sign-in, swap the code for tokens,
 * test, save). Everything secret stays on the server.
 */

/** Where the authorization server sends the browser back. Exactly what's registered. */
export const mcpSignInRedirectUri = () => `${appConfig().appOrigin}/api/mcp/oauth/callback`;

/**
 * Where the browser may go back to after signing in: an app or one of its
 * dashboards, on our own site. Anything else (another site, another path) is
 * refused, so the callback can never be an open redirect.
 */
const RETURN_PATH = /^\/apps\/[0-9a-f-]{36}(\/dashboards\/[0-9a-f-]{36})?$/;

const startSchema = z.union([
  z.object({ name: connectionNameSchema, url: z.string() }).strict(),
  z.object({ connectionId: z.uuid(), returnTo: z.string().regex(RETURN_PATH).optional() }).strict(),
]);

/** What a pending sign-in keeps sealed, besides the settings it will save. */
type PendingSecret = PendingSignIn & { requireIss: boolean; returnTo?: string };

type Deps = { service?: ConnectionService; testHooks?: OAuthTestHooks; redirectUri?: string };

/** Starts a sign-in for a new server, or again for an existing connection. Returns where to send the browser. */
export async function startMcpSignIn(userId: string, input: unknown, deps: Deps = {}): Promise<Result<{ authorizationUrl: string }>> {
  const service = deps.service ?? getConnectionService();
  const parsed = startSchema.safeParse(input);
  if (!parsed.success) return fromValidation(parsed.error);

  let name: string;
  let url: string;
  let connectionId: string | null = null;
  let returnTo: string | undefined;
  if ("connectionId" in parsed.data) {
    ({ returnTo } = parsed.data);
    const existing = await service.open(userId, parsed.data.connectionId, "mcp");
    if (!existing) return notFound();
    ({ name } = existing);
    url = (existing.config as { url: string }).url;
    connectionId = existing.id;
  } else {
    const settings = mcpConfigSchema.safeParse({ url: parsed.data.url });
    if (!settings.success) return fromValidation(settings.error);
    ({ url } = settings.data);
    ({ name } = parsed.data);
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
    const saved = await service.startSignIn(userId, {
      stateHash: started.stateHash,
      connectionId,
      name,
      config: { type: "mcp", url, headerName: "Authorization", oauth: discovery.settings },
      pending: JSON.stringify(pending),
    });
    if (!saved.ok) return saved;
    return ok({ authorizationUrl: started.authorizationUrl.href });
  } catch (error) {
    return failure("start", error);
  }
}

/** Finishes a sign-in from the callback's query parameters. */
export async function finishMcpSignIn(
  userId: string,
  params: URLSearchParams,
  deps: Deps = {},
): Promise<Result<{ id: string; returnTo: string | null }>> {
  const service = deps.service ?? getConnectionService();
  const state = params.get("state");
  if (!state) return fail({ code: "oauth_failed", message: "The sign-in came back without its state, so it can't be trusted. Start again." });

  // Taken once, for this user only, before it expires: a replayed or someone else's callback finds nothing.
  const taken = await service.takeSignIn(userId, hashState(state));
  if (!taken) {
    return fail({ code: "oauth_expired", message: "This sign-in expired or was already used. Start it again from Data Connections." });
  }
  const serverError = params.get("error");
  if (serverError) {
    const reason = serverError === "access_denied" ? "access was denied" : serverError;
    return fail({ code: "oauth_failed", message: `The server didn't sign you in (${reason.slice(0, 100)}).` });
  }
  const code = params.get("code");
  if (!code) return fail({ code: "oauth_failed", message: "The sign-in came back without a code. Start again." });

  if (taken.config.type !== "mcp" || !taken.config.oauth) return internalError();
  const settings = taken.config.oauth;
  const pending = JSON.parse(taken.pending) as PendingSecret;

  // RFC 9207: the response must come from the authorization server this sign-in went to.
  const iss = params.get("iss");
  if ((iss !== null && iss.replace(/\/+$/, "") !== settings.issuer.replace(/\/+$/, "")) || (iss === null && pending.requireIss)) {
    return fail({ code: "oauth_invalid", message: "The sign-in came back from a different authorization server, so it was refused." });
  }

  try {
    const tokens = await exchangeOAuthCode(settings, pending, code, deps.testHooks);
    const credential = writeOAuthCredential({ kind: "oauth", client: pending.client, tokens });
    const saved = await service.saveSignedIn(userId, { connectionId: taken.connectionId, name: taken.name, config: taken.config, credential });
    // Checked again on the way out: only our own app paths, ever.
    const back = pending.returnTo && RETURN_PATH.test(pending.returnTo) ? pending.returnTo : null;
    return saved.ok ? ok({ id: saved.data.id, returnTo: back }) : saved;
  } catch (error) {
    return failure("finish", error);
  }
}

function failure(step: string, error: unknown): Result<never> {
  const known = fromCheckError(error);
  if (known) return fail(known.error);
  if (error instanceof McpError) return fail({ code: error.code, message: "The sign-in didn't complete. Try again." });
  logError(`mcpSignIn.${step}`, error);
  return internalError();
}
