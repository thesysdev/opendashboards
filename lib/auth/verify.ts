import { config, secrets, type Environment } from "@/config";

/**
 * Who may use Prism, once Supabase has verified a session (`getClaims()` in
 * `proxy.ts` and `requireUser()`). Reusing that project means every OpenUI
 * demo user has a valid session, so an allowlist decides who gets in.
 *
 * Framework-free so `proxy.ts` and `requireUser()` share it and it can be tested.
 */

/** Local development only: who to act as. */
export const USER_ID_HEADER = "x-user-id";

const USER_ID_PATTERN = /^[A-Za-z0-9_.:@-]{1,128}$/;

/** Who may use Prism. Entries are lowercase. */
export type Allowlist = { domains: string[]; emails: string[] };
export type AuthFailure = "signed_out" | "bad_token" | "bad_user" | "not_allowed";
export type AuthResult = { ok: true; userId: string; email?: string } | { ok: false; reason: AuthFailure };

export type AuthConfig = { mode: "session"; allowlist: Allowlist } | { mode: "dev"; devUserId: string };

export class AuthConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthConfigError";
  }
}

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

/** Fails closed: outside local there's no dev user, so Supabase and an allowlist are required. */
export function getAuthConfig(settings: AuthSettings = currentAuthSettings()): AuthConfig {
  if (settings.environment !== "local" && settings.devUserId !== null) {
    throw new AuthConfigError(`${settings.environment} can't have a dev user; only local may skip sign-in`);
  }
  if (settings.supabaseUrl) {
    if (!settings.allowlist.domains.length && !settings.allowlist.emails.length) {
      throw new AuthConfigError("PRISM_ALLOWED_DOMAINS or PRISM_ALLOWED_EMAILS must be set");
    }
    return { mode: "session", allowlist: settings.allowlist };
  }
  if (settings.devUserId === null) throw new AuthConfigError("SUPABASE_URL must be set outside local");
  if (!USER_ID_PATTERN.test(settings.devUserId)) throw new AuthConfigError("The configured dev user id has an invalid format");
  return { mode: "dev", devUserId: settings.devUserId };
}

/** Local development: the dev user, or whoever X-User-Id names. */
export function devUser(headers: { get(name: string): string | null }, devUserId: string): AuthResult {
  const userId = headers.get(USER_ID_HEADER) ?? devUserId;
  return USER_ID_PATTERN.test(userId) ? { ok: true, userId } : { ok: false, reason: "bad_user" };
}

function isAllowed(email: string, { domains, emails }: Allowlist): boolean {
  const address = email.toLowerCase();
  return emails.includes(address) || domains.includes(address.slice(address.lastIndexOf("@") + 1));
}

/** Decides what a verified session may do: signed-in, non-anonymous, with a verified, allowlisted email. */
export function checkClaims(claims: Record<string, unknown> | null | undefined, allowlist: Allowlist): AuthResult {
  if (!claims) return { ok: false, reason: "signed_out" };
  if (claims.role !== "authenticated" || claims.aud !== "authenticated" || claims.is_anonymous === true) {
    return { ok: false, reason: "bad_token" };
  }
  if (typeof claims.sub !== "string" || !USER_ID_PATTERN.test(claims.sub)) return { ok: false, reason: "bad_user" };

  const email = typeof claims.email === "string" ? claims.email : undefined;
  const metadata = claims.user_metadata as { email_verified?: unknown } | undefined;
  if (!email || metadata?.email_verified !== true || !isAllowed(email, allowlist)) return { ok: false, reason: "not_allowed" };
  return { ok: true, userId: claims.sub, email };
}
