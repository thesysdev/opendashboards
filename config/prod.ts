import type { EnvironmentSettings } from "./settings";

/** Production builds and `next start`, behind the gateway. */
export const prod: EnvironmentSettings = {
  auth: { devUser: null, publicHost: "opendashboards.com" },
  appOrigin: "https://opendashboards.com",
  // Off until the gateway serves /oauth/client-metadata.json without sign-in or Bot Protection.
  mcpClientMetadataDocument: false,
  secrets: { allowPlaintext: false },
  network: { connectAttemptTimeoutMs: null },
  // Loaded from STRIPE_PRICE_* and STRIPE_PORTAL_* env vars when set (scripts/stripe-setup.mjs prints them).
  plans: null,
};
