import { createRemoteJWKSet, errors, jwtVerify, type JWTVerifyGetKey } from "jose";

import { config, secrets, type Environment } from "@/config";

/**
 * Decides who a request is for.
 *
 * `proxy.ts` reads the Supabase session from its cookies and passes the access
 * token on as an `Authorization` header, replacing whatever the browser sent.
 * The token is checked against Supabase's public keys here, so identity is
 * never taken from an unsigned header. Reusing that Supabase project means
 * every OpenUI demo user holds a valid token, so an allowlist decides who may
 * use Prism.
 *
 * This module is framework-free so both `proxy.ts` and `requireUser()` use
 * the exact same check, and so it can be unit tested.
 */

/** Local development only: who to act as. */
export const USER_ID_HEADER = "x-user-id";
export const AUTHORIZATION_HEADER = "authorization";

const USER_ID_PATTERN = /^[A-Za-z0-9_.:@-]{1,128}$/;
const BEARER_PATTERN = /^Bearer ([^\s]+)$/i;

/** Asymmetric only: Prism must never hold anything that can mint a token. */
const TOKEN_ALGORITHMS = ["ES256", "RS256"];

/** Who may use Prism. Entries are lowercase. */
export type Allowlist = { domains: string[]; emails: string[] };

export type AuthFailure = "missing_token" | "bad_token" | "bad_user" | "not_allowed" | "auth_unavailable";
export type AuthResult = { ok: true; userId: string; email?: string } | { ok: false; reason: AuthFailure };

export type TokenVerifier = (token: string) => Promise<AuthResult>;

export type AuthConfig =
  /** Requests carry a Supabase access token, set by `proxy.ts`. */
  | { mode: "session"; verifyToken: TokenVerifier }
  /** Local development without sign-in: a fixed or header-supplied user. */
  | { mode: "dev"; devUserId: string };

export class AuthConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthConfigError";
  }
}

/** What auth needs from the configuration. */
export type AuthSettings = {
  environment: Environment;
  devUserId: string | null;
  supabaseUrl: string | undefined;
  allowlist: Allowlist;
};

const currentAuthSettings = (): AuthSettings => {
  const { env, auth } = config();
  return {
    environment: env,
    devUserId: auth.devUserId,
    supabaseUrl: secrets.supabaseUrl(),
    allowlist: { domains: secrets.allowedDomains(), emails: secrets.allowedEmails() },
  };
};

function isAllowed(email: string | undefined, { domains, emails }: Allowlist): boolean {
  if (!email) return false;
  const address = email.toLowerCase();
  const domain = address.slice(address.lastIndexOf("@") + 1);
  return emails.includes(address) || domains.includes(domain);
}

/**
 * Checks a Supabase access token against the project's public keys: signature,
 * issuer, audience and expiry. Only a signed-in, non-anonymous user with a
 * verified, allowlisted email passes.
 */
export function createTokenVerifier(supabaseUrl: string, keys: JWTVerifyGetKey, allowlist: Allowlist): TokenVerifier {
  const issuer = `${supabaseUrl.replace(/\/+$/, "")}/auth/v1`;
  return async (token) => {
    try {
      const { payload } = await jwtVerify(token, keys, { issuer, audience: "authenticated", algorithms: TOKEN_ALGORITHMS });
      if (payload.role !== "authenticated" || payload.is_anonymous === true) return { ok: false, reason: "bad_token" };
      if (typeof payload.sub !== "string" || !USER_ID_PATTERN.test(payload.sub)) return { ok: false, reason: "bad_user" };

      const email = typeof payload.email === "string" ? payload.email : undefined;
      const metadata = payload.user_metadata as { email_verified?: unknown } | undefined;
      if (metadata?.email_verified !== true || !isAllowed(email, allowlist)) return { ok: false, reason: "not_allowed" };
      return { ok: true, userId: payload.sub, email };
    } catch (error) {
      // No usable key set (or none in time) says nothing about the token.
      if (error instanceof errors.JWKSTimeout || error instanceof errors.JWKSInvalid) return { ok: false, reason: "auth_unavailable" };
      if (error instanceof errors.JOSEError) return { ok: false, reason: "bad_token" };
      return { ok: false, reason: "auth_unavailable" };
    }
  };
}

// Kept between requests, so the fetched public keys are reused.
let keys: JWTVerifyGetKey | undefined;

/**
 * Decides how requests are authenticated. Fails closed: outside local there
 * is never a dev user, so Supabase and an allowlist are required and nothing
 * runs unauthenticated. Locally, setting SUPABASE_URL turns sign-in on.
 *
 * Startup validation already refuses these cases; this refuses them again in
 * case a request somehow gets this far.
 */
export function getAuthConfig(settings: AuthSettings = currentAuthSettings()): AuthConfig {
  if (settings.environment !== "local" && settings.devUserId !== null) {
    throw new AuthConfigError(`${settings.environment} can't have a dev user; only local may skip sign-in`);
  }
  if (settings.supabaseUrl) {
    if (!settings.allowlist.domains.length && !settings.allowlist.emails.length) {
      throw new AuthConfigError("PRISM_ALLOWED_DOMAINS or PRISM_ALLOWED_EMAILS must be set");
    }
    keys ??= createRemoteJWKSet(new URL(`${settings.supabaseUrl.replace(/\/+$/, "")}/auth/v1/.well-known/jwks.json`));
    return { mode: "session", verifyToken: createTokenVerifier(settings.supabaseUrl, keys, settings.allowlist) };
  }
  if (settings.devUserId === null) {
    throw new AuthConfigError("SUPABASE_URL must be set outside local");
  }
  if (!USER_ID_PATTERN.test(settings.devUserId)) {
    throw new AuthConfigError("The configured dev user id has an invalid format");
  }
  return { mode: "dev", devUserId: settings.devUserId };
}

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
