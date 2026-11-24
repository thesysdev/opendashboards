import type { EnvironmentSettings } from "./settings";

/** Production builds and `next start`, behind the gateway. */
export const prod: EnvironmentSettings = {
  auth: { devUser: null, publicHost: "opendashboards.com" },
  appOrigin: "https://opendashboards.com",
  secrets: { allowPlaintext: false },
  network: { connectAttemptTimeoutMs: null },
  // Off until the live-mode Stripe ids are in: then `hostedPlans({ standard: …, team: … })` from ./plans.
  plans: null,
};
