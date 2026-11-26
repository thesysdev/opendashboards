import "server-only";

import Stripe from "stripe";

import { config, secrets } from "@/config";
import { identifyWorkspacePlan, track } from "@/lib/analytics";
import { createBilling, type SubscriptionChange } from "@/lib/billing";
import { getDb, type Database } from "@/lib/db";
import { createEnforcement, OPEN_GATE, type Enforcement, type Gate } from "@/lib/entitlements";
import { createOrgService } from "@/lib/orgs/service";

import { createPlans, type Plans } from "./plans";

export { createPlans, entitlementsOf, type Plans, type PlanState } from "./plans";

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
    onChange: trackSubscription,
  });
  return (plans = createPlans({ db, settings, billing, track }));
}

/** A subscription started, changed or ended: the event, and the workspace group's plan. */
export function trackSubscription(change: SubscriptionChange): void {
  identifyWorkspacePlan(change.orgId, { plan_id: change.plan, seats: change.seats, subscription_status: change.status });
  // With nobody to attribute it to, the group's plan is all that's kept.
  if (!change.userId) return;
  const interval = change.interval === "year" ? "annual" : change.interval === "month" ? "monthly" : null;
  track(
    change.userId,
    `subscription_${change.kind}`,
    {
      plan_id: change.plan,
      previous_plan_id: change.previousPlan,
      interval,
      seats: change.seats,
      status: change.status,
      cancel_at_period_end: change.cancelAtPeriodEnd,
    },
    change.orgId,
  );
  if (change.kind === "changed" && change.seats !== change.previousSeats) {
    track(change.userId, "seats_changed", { from_seats: change.previousSeats, to_seats: change.seats, plan_id: change.plan }, change.orgId);
  }
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
