import { createRemoteJWKSet, errors, jwtVerify, type JWTVerifyGetKey } from "jose";

import { config, secrets, type Environment } from "@/config";

/**
 * Gateway authentication.
 *
 * In front of Prism sits a gateway that signs users in with Supabase and
 * forwards their access token. The token is verified against Supabase's public
 * keys, so identity is never taken from an unsigned header. Only Deployment
 * Protection keeps requests from reaching Prism without the gateway.
 *
 * This module is framework-free so both `proxy.ts` and `requireUser()` use
 * the exact same check, and so it can be unit tested.
 */

/** Local development only: who to act as. Ignored when a gateway is in front. */
export const USER_ID_HEADER = "x-user-id";
export const AUTHORIZATION_HEADER = "authorization";

const USER_ID_PATTERN = /^[A-Za-z0-9_.:@-]{1,128}$/;
const BEARER_PATTERN = /^Bearer ([^\s]+)$/i;

/** Asymmetric only: Prism must never hold anything that can mint a token. */
const TOKEN_ALGORITHMS = ["ES256", "RS256"];

export type TokenCheck = { ok: true; userId: string; email?: string } | { ok: false; reason: "bad_token" | "bad_user" | "auth_unavailable" };
export type TokenVerifier = (token: string) => Promise<TokenCheck>;

export type AuthConfig =
  /** Requests must carry a user token. */
  | { mode: "gateway"; verifyToken: TokenVerifier }
  /** Local development without a gateway: no secret, a fixed or header-supplied user. */
  | { mode: "dev"; devUserId: string };

export class AuthConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthConfigError";
  }
}

/** What auth needs from the configuration: the environment, its dev user and Supabase. */
export type AuthSettings = {
  environment: Environment;
  devUserId: string | null;
  supabaseUrl: string | undefined;
};

const currentAuthSettings = (): AuthSettings => {
  const { env, auth } = config();
  return {
    environment: env,
    devUserId: auth.devUserId,
    supabaseUrl: secrets.supabaseUrl(),
  };
};

/**
 * Checks a Supabase access token against the project's public keys: signature,
 * issuer, audience and expiry. Only a signed-in, non-anonymous user passes.
 */
export function createTokenVerifier(supabaseUrl: string, keys: JWTVerifyGetKey): TokenVerifier {
  const issuer = `${supabaseUrl.replace(/\/+$/, "")}/auth/v1`;
  return async (token) => {
    try {
      const { payload } = await jwtVerify(token, keys, { issuer, audience: "authenticated", algorithms: TOKEN_ALGORITHMS });
      if (payload.role !== "authenticated" || payload.is_anonymous === true) return { ok: false, reason: "bad_token" };
      if (typeof payload.sub !== "string" || !USER_ID_PATTERN.test(payload.sub)) return { ok: false, reason: "bad_user" };
      const email = typeof payload.email === "string" && payload.email ? payload.email : undefined;
      return { ok: true, userId: payload.sub, email };
    } catch (error) {
      // No usable key set (or none in time) says nothing about the token.
      if (error instanceof errors.JWKSTimeout || error instanceof errors.JWKSInvalid) return { ok: false, reason: "auth_unavailable" };
      if (error instanceof errors.JOSEError) return { ok: false, reason: "bad_token" };
      return { ok: false, reason: "auth_unavailable" };
    }
  };
}

// One verifier per project, so the fetched public keys are reused between requests.
const verifiers = new Map<string, TokenVerifier>();

function verifierFor(supabaseUrl: string): TokenVerifier {
  let verifier = verifiers.get(supabaseUrl);
  if (!verifier) {
    const jwks = createRemoteJWKSet(new URL(`${supabaseUrl.replace(/\/+$/, "")}/auth/v1/.well-known/jwks.json`));
    verifier = createTokenVerifier(supabaseUrl, jwks);
    verifiers.set(supabaseUrl, verifier);
  }
  return verifier;
}

/**
 * Decides how requests are authenticated. Fails closed: outside local there
 * is never a dev user, so Supabase is required and nothing runs
 * unauthenticated. Locally, setting SUPABASE_URL turns the check on.
 *
 * Startup validation already refuses these cases; this refuses them again in
 * case a request somehow gets this far.
 */
export function getAuthConfig(settings: AuthSettings = currentAuthSettings()): AuthConfig {
  if (settings.environment !== "local" && settings.devUserId !== null) {
    throw new AuthConfigError(`${settings.environment} can't have a dev user; only local may skip the gateway`);
  }
  if (settings.supabaseUrl) return { mode: "gateway", verifyToken: verifierFor(settings.supabaseUrl) };
  if (settings.devUserId === null) {
    throw new AuthConfigError("SUPABASE_URL must be set outside local");
  }
  if (!USER_ID_PATTERN.test(settings.devUserId)) {
    throw new AuthConfigError("The configured dev user id has an invalid format");
  }
  return { mode: "dev", devUserId: settings.devUserId };
}

export type AuthResult =
  | { ok: true; userId: string; email?: string }
  | { ok: false; reason: "missing_token" | "bad_token" | "bad_user" | "auth_unavailable" };

interface HeaderReader {
  get(name: string): string | null;
}

/** Decides who a request is for, or why it's refused. */
export async function authenticate(headers: HeaderReader, config: AuthConfig): Promise<AuthResult> {
  if (config.mode === "dev") {
    // Locally, X-User-Id may still be sent to act as another user.
    const userId = headers.get(USER_ID_HEADER) ?? config.devUserId;
    return USER_ID_PATTERN.test(userId) ? { ok: true, userId } : { ok: false, reason: "bad_user" };
  }

  const token = headers.get(AUTHORIZATION_HEADER)?.match(BEARER_PATTERN)?.[1];
  if (!token) return { ok: false, reason: "missing_token" };
  return config.verifyToken(token);
}
