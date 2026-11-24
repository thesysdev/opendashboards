import type { AuthProvider, AuthUser } from "../provider";

/**
 * Local development only: lets one browser act as several people, to try
 * teams and sharing. The cookie names a made-up user; without it every
 * request is the configured dev user. It is never read outside local, where
 * this provider doesn't exist.
 */
export const DEV_USER_COOKIE = "od_dev_user";

/** Stand-in people to act as, besides the configured dev user. */
export const DEV_USER_NAMES = ["alice", "bob", "carol"] as const;

const devUserNamed = (name: string): AuthUser => ({ id: `dev-${name}`, email: `${name}@example.dev` });

function cookieValue(header: string | null, name: string): string | null {
  for (const part of (header ?? "").split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (key === name) return value.join("=");
  }
  return null;
}

/** Local development: every request is the configured user, or the stand-in the dev cookie names. */
export function devProvider(user: AuthUser): AuthProvider {
  return {
    authenticate: async (headers) => {
      const name = cookieValue(headers.get("cookie"), DEV_USER_COOKIE);
      const standIn = (DEV_USER_NAMES as readonly string[]).includes(name ?? "") ? devUserNamed(name!) : null;
      return { ok: true, user: standIn ?? { id: user.id, email: user.email } };
    },
  };
}
