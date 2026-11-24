import type { Entitlements } from "../lib/entitlements/types";

/*
 * The hosted service's plans: what each is called, what it grants, and its
 * Stripe prices. Self-hosted and local installs have none (settings `plans:
 * null`): no billing and no limits. Each environment passes its own Stripe ids.
 */

/** A paid plan's Stripe prices and the portal configurations used while on it. */
export type StripePlan = {
  /** Price ids, tax exclusive. */
  monthly: string;
  annual: string;
  /** Billing portal configuration ids, by the subscription's interval: annual ones offer no switch back to monthly. */
  portal: {
    month: string;
    year: string;
    /** Per-seat plans only: the seat-change confirm page, the one place the seat count can change. */
    seats?: string;
  };
};

export type CatalogPlan =
  | {
      name: string;
      perSeat: false;
      entitlements: Entitlements;
      /** null: free, nothing to pay. */
      stripe: StripePlan | null;
    }
  | {
      name: string;
      /** Paid per seat: its editor limit is the seats bought, so it can't state one. */
      perSeat: true;
      entitlements: Omit<Entitlements, "editors">;
      stripe: StripePlan;
    };

export type PlansSettings = {
  /** The plan a workspace is on without a subscription. */
  free: string;
  /** Every plan, cheapest first: an upgrade prompt suggests the first one above the workspace's. */
  catalog: Record<string, CatalogPlan>;
  /** Where people are sent for what Billing doesn't offer. */
  supportEmail: string;
};

export const STRIPE_PLAN_ENV_VARS = [
  "STRIPE_PRICE_STANDARD_MONTHLY",
  "STRIPE_PRICE_STANDARD_ANNUAL",
  "STRIPE_PORTAL_STANDARD_MONTHLY",
  "STRIPE_PORTAL_STANDARD_ANNUAL",
  "STRIPE_PRICE_TEAM_MONTHLY",
  "STRIPE_PRICE_TEAM_ANNUAL",
  "STRIPE_PORTAL_TEAM_MONTHLY",
  "STRIPE_PORTAL_TEAM_ANNUAL",
  "STRIPE_PORTAL_TEAM_SEATS",
] as const;

/** Build hosted plans from Stripe env vars; returns null when none are set. */
function stripEnvValue(raw: string | undefined): string {
  const value = raw?.trim() ?? "";
  const withoutAssignment = value.replace(/^[A-Z0-9_]+=\s*/, "");
  const firstToken = withoutAssignment.split(/\s+/)[0] ?? "";
  return firstToken.replace(/^["']|["']$/g, "");
}

export function plansFromEnv(env: Record<string, string | undefined>): PlansSettings | null {
  const read = (name: (typeof STRIPE_PLAN_ENV_VARS)[number]) => stripEnvValue(env[name]);
  if (!STRIPE_PLAN_ENV_VARS.some((name) => read(name).length > 0)) return null;
  return hostedPlans({
    standard: {
      monthly: read("STRIPE_PRICE_STANDARD_MONTHLY"),
      annual: read("STRIPE_PRICE_STANDARD_ANNUAL"),
      portal: {
        month: read("STRIPE_PORTAL_STANDARD_MONTHLY"),
        year: read("STRIPE_PORTAL_STANDARD_ANNUAL"),
      },
    },
    team: {
      monthly: read("STRIPE_PRICE_TEAM_MONTHLY"),
      annual: read("STRIPE_PRICE_TEAM_ANNUAL"),
      portal: {
        month: read("STRIPE_PORTAL_TEAM_MONTHLY"),
        year: read("STRIPE_PORTAL_TEAM_ANNUAL"),
        seats: read("STRIPE_PORTAL_TEAM_SEATS"),
      },
    },
  });
}

/** OpenDashboards' plans, with one environment's Stripe ids. */
export function hostedPlans(stripe: { standard: StripePlan; team: StripePlan }): PlansSettings {
  return {
    free: "free",
    supportEmail: "support@thesys.dev",
    catalog: {
      free: {
        name: "Free",
        perSeat: false,
        entitlements: { editors: { max: 1 }, connections: { max: 3 }, apps: { max: 5 }, viewerRole: { on: false } },
        stripe: null,
      },
      standard: {
        name: "Standard",
        perSeat: false,
        entitlements: { editors: { max: 1 }, connections: { max: 10 }, apps: { max: 25 }, viewerRole: { on: false } },
        stripe: stripe.standard,
      },
      team: {
        name: "Team",
        perSeat: true,
        entitlements: { connections: { max: 25 }, apps: { max: 100 }, viewerRole: { on: true } },
        stripe: stripe.team,
      },
    },
  };
}
