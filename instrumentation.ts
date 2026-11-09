/**
 * Runs once when the server starts. It sets how patiently outbound
 * connections are opened, and checks configuration so a misconfigured
 * production deployment fails loudly instead of at the first request. Each
 * check also runs per request (proxy, secret storage), so this is the early
 * warning, not the only guard.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { configureConnectTimeouts } = await import("@/lib/net/connect-timeouts");
  const { getAuthConfig } = await import("@/lib/auth/gateway");
  const { getSecretBox } = await import("@/lib/secrets");

  configureConnectTimeouts();
  getAuthConfig();
  getSecretBox();
}
