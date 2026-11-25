import type { EnvironmentSettings } from "./settings";

/** `next dev` and tests, on a developer's machine. */
export const local: EnvironmentSettings = {
  auth: { devUser: { id: "dev-user", email: "user@example.dev" }, publicHost: null },
  // The port `next dev` actually listens on (it sets PORT), so OAuth comes back to this server.
  appOrigin: `http://localhost:${process.env.PORT || 3100}`,
  secrets: { allowPlaintext: true },
  // Home and office networks are often slow, or have IPv6 that goes nowhere.
  network: { connectAttemptTimeoutMs: 2_000 },
  // Off: no billing, no limits. To try billing, set `hostedPlans({ … })` from ./plans with
  // Stripe test-mode ids (scripts/stripe-setup.mjs prints them), plus STRIPE_SECRET_KEY and
  // STRIPE_WEBHOOK_SECRET (`stripe listen --forward-to localhost:3100/api/stripe/webhook`).
  plans: null,
};
