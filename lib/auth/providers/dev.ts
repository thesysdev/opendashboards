import type { AuthProvider } from "../provider";

/** Local development: every request is the configured user. */
export function devProvider(devUserId: string): AuthProvider {
  return {
    authenticate: async () => ({ ok: true, user: { id: devUserId, email: null } }),
  };
}
