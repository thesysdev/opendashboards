import { createHash, timingSafeEqual } from "node:crypto";

import { config, MIN_GATEWAY_SECRET_LENGTH, secrets, type Environment } from "@/config";

/**
 * Gateway authentication.
 *
 * In front of Prism sits a gateway that authenticates the user and forwards
 * two headers: the user's id and a shared secret only the gateway knows. The
 * secret proves the request came through the gateway, so the user id can be
 * trusted. Without it, anyone who reaches the app directly (a *.vercel.app
 * URL, a preview deployment) could claim to be any user.
 *
 * This module is framework-free so both `proxy.ts` and `requireUser()` use
 * the exact same check, and so it can be unit tested.
 */

export const USER_ID_HEADER = "x-user-id";
export const GATEWAY_SECRET_HEADER = "x-gateway-secret";

const USER_ID_PATTERN = /^[A-Za-z0-9_.:@-]{1,128}$/;

export type AuthConfig =
  /** Requests must carry the gateway secret; the user id comes from the header. */
  | { mode: "gateway"; secret: string }
  /** Local development without a gateway: no secret, a fixed or header-supplied user. */
  | { mode: "dev"; devUserId: string };

export class AuthConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthConfigError";
  }
}

/** What auth needs from the configuration: the environment, its dev user, and the gateway secret. */
export type AuthSettings = { environment: Environment; devUserId: string | null; gatewaySecret: string | undefined };

const currentAuthSettings = (): AuthSettings => {
  const { env, auth } = config();
  return { environment: env, devUserId: auth.devUserId, gatewaySecret: secrets.gatewaySecret() };
};

/**
 * Decides how requests are authenticated. Fails closed: outside local there
 * is never a dev user, so the gateway secret is required and nothing runs
 * unauthenticated. Locally a gateway secret, if set, is used too.
 *
 * Startup validation (next.config.ts) already refuses these cases; this
 * refuses them again in case a request somehow gets this far.
 */
export function getAuthConfig(settings: AuthSettings = currentAuthSettings()): AuthConfig {
  if (settings.environment !== "local" && settings.devUserId !== null) {
    throw new AuthConfigError(`${settings.environment} can't have a dev user; only local may skip the gateway`);
  }
  const secret = settings.gatewaySecret;
  if (secret) {
    if (secret.length < MIN_GATEWAY_SECRET_LENGTH) {
      throw new AuthConfigError(
        `GATEWAY_SHARED_SECRET must be at least ${MIN_GATEWAY_SECRET_LENGTH} characters`,
      );
    }
    return { mode: "gateway", secret };
  }
  if (settings.devUserId === null) {
    throw new AuthConfigError("GATEWAY_SHARED_SECRET must be set outside local");
  }
  if (!USER_ID_PATTERN.test(settings.devUserId)) {
    throw new AuthConfigError("The configured dev user id has an invalid format");
  }
  return { mode: "dev", devUserId: settings.devUserId };
}

export type AuthResult =
  | { ok: true; userId: string }
  | { ok: false; reason: "missing_secret" | "bad_secret" | "missing_user" | "bad_user" };

interface HeaderReader {
  get(name: string): string | null;
}

/** Decides who a request is for, or why it's refused. */
export function authenticate(headers: HeaderReader, config: AuthConfig): AuthResult {
  if (config.mode === "dev") {
    // Locally, X-User-Id may still be sent to act as another user.
    const userId = headers.get(USER_ID_HEADER) ?? config.devUserId;
    return USER_ID_PATTERN.test(userId) ? { ok: true, userId } : { ok: false, reason: "bad_user" };
  }

  const presented = headers.get(GATEWAY_SECRET_HEADER);
  if (!presented) return { ok: false, reason: "missing_secret" };
  if (!secretsMatch(presented, config.secret)) return { ok: false, reason: "bad_secret" };

  const userId = headers.get(USER_ID_HEADER);
  if (!userId) return { ok: false, reason: "missing_user" };
  if (!USER_ID_PATTERN.test(userId)) return { ok: false, reason: "bad_user" };
  return { ok: true, userId };
}

/**
 * Constant-time comparison. Hashing first gives both sides the same length,
 * so neither the content nor the length of the secret leaks through timing.
 */
function secretsMatch(presented: string, expected: string): boolean {
  const a = createHash("sha256").update(presented).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}
