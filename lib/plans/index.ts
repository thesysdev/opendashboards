import "server-only";

import Stripe from "stripe";

import { config, secrets } from "@/config";
import { createBilling } from "@/lib/billing";
import { getDb, type Database } from "@/lib/db";
import { createEnforcement, OPEN_GATE, type Enforcement, type Gate } from "@/lib/entitlements";
import { createOrgService } from "@/lib/orgs/service";

import { createPlans, type Plans } from "./plans";

export { createPlans, entitlementsOf, type Plans } from "./plans";

/*
 * Wiring. With plans in config, billing and enforcement are built and joined
 * here. Without (self-hosted, local by default), neither is: everything is
 * allowed, and nothing else in the app changes.
 */

let plans: Plans | null | undefined;

/** The plans, or null when billing is off. */
export function getPlans(): Plans | null {
  if (plans !== undefined) return plans;
  const settings = config().plans;
  if (!settings) return (plans = null);
  const db = getDb();
  const stripe = new Stripe(secrets.stripeSecretKey() ?? "");
  const billing = createBilling({
    db,
    stripe,
    plans: Object.entries(settings.catalog).map(([id, plan]) => ({ id, name: plan.name, perSeat: plan.perSeat, stripe: plan.stripe })),
    freePlan: settings.free,
    webhookSecret: secrets.stripeWebhookSecret() ?? "",
    origin: config().appOrigin,
    async createWorkspace(tx, { userId, pending }) {
      const created = await createOrgService({ db: tx as unknown as Database }).create({ id: userId, email: "" }, { name: pending.name });
      if (!created.ok) throw new Error(`Couldn't create the paid workspace: ${created.error.message}`);
      return created.data.id;
    },
  });
  return (plans = createPlans({ db, settings, billing }));
}

const OPEN: Enforcement = createEnforcement();

/** What the services check before a gated operation. Lets everything through when billing is off. */
export function getGate(): Gate {
  return getPlans()?.gate ?? OPEN_GATE;
}

/** Limits and usage, for pages. Unlimited when billing is off. */
export function getEnforcement(): Enforcement {
  return getPlans()?.enforcement ?? OPEN;
}
