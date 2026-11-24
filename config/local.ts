import type { EnvironmentSettings } from "./settings";

/** `next dev` and tests, on a developer's machine. */
export const local: EnvironmentSettings = {
  auth: { devUser: { id: "dev-user", email: "user@example.dev" }, publicHost: null },
  // The port `next dev` actually listens on (it sets PORT), so OAuth comes back to this server.
  appOrigin: `http://localhost:${process.env.PORT || 3100}`,
  // Authorization servers can't fetch a document from localhost: register instead.
  mcpClientMetadataDocument: false,
  secrets: { allowPlaintext: true },
  // Home and office networks are often slow, or have IPv6 that goes nowhere.
  network: { connectAttemptTimeoutMs: 2_000 },
};
