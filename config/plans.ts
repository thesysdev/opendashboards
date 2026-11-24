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
  portal: { month: string; year: string };
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
