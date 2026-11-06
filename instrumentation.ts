/**
 * Checks configuration when the server starts, so a misconfigured production
 * deployment fails loudly instead of at the first request. Each check also
 * runs per request (proxy, secret storage), so this is the early warning,
 * not the only guard.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { getAuthConfig } = await import("@/lib/auth/gateway");
  const { getSecretBox } = await import("@/lib/secrets");

  getAuthConfig();
  getSecretBox();
}
