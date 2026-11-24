#!/usr/bin/env node
/**
 * Sets up what OpenDashboards needs in a Stripe account and prints the ids for
 * config (`hostedPlans({ … })` in config/plans.ts). Safe to run again: it
 * finds what's there by lookup key and metadata, and creates only what's missing.
 *
 *   STRIPE_SECRET_KEY=sk_test_… node scripts/stripe-setup.mjs https://opendashboards.com
 *
 * The argument is where the portal's "return" and terms links point.
 *
 * Products: "OpenDashboards Standard" ($24 a month or $228 a year, flat) and
 * "OpenDashboards Team" ($49 or $468 per editor), tax exclusive.
 *
 * Portal configurations, one per plan and period, so nothing moves down:
 * Standard can switch to Team; monthly can switch to annual, never back;
 * the seat count is never editable there (Billing changes it through the
 * confirm flow). Cancelling ends at the period's end. Proration is invoiced
 * at once.
 */
import Stripe from "stripe";

const key = process.env.STRIPE_SECRET_KEY;
const origin = process.argv[2];
if (!key || !origin) {
  console.error("Usage: STRIPE_SECRET_KEY=… node scripts/stripe-setup.mjs <app origin>");
  process.exit(1);
}
const stripe = new Stripe(key);

const PLANS = {
  standard: { name: "OpenDashboards Standard", unit: undefined, monthly: 2400, annual: 22800 },
  team: { name: "OpenDashboards Team", unit: "editor", monthly: 4900, annual: 46800 },
};

async function product(id, { name, unit }) {
  const found = await stripe.products.search({ query: `metadata['od_plan']:'${id}'` });
  if (found.data[0]) return found.data[0];
  return stripe.products.create({ name, unit_label: unit, tax_code: "txcd_10103001", metadata: { od_plan: id } });
}

async function price(productId, lookupKey, amount, interval) {
  const found = await stripe.prices.list({ lookup_keys: [lookupKey], limit: 1 });
  if (found.data[0]) return found.data[0];
  return stripe.prices.create({
    product: productId,
    lookup_key: lookupKey,
    currency: "usd",
    unit_amount: amount,
    recurring: { interval },
    tax_behavior: "exclusive",
  });
}

const prices = {};
for (const [id, plan] of Object.entries(PLANS)) {
  const { id: productId } = await product(id, plan);
  prices[id] = {
    product: productId,
    monthly: (await price(productId, `od_${id}_monthly`, plan.monthly, "month")).id,
    annual: (await price(productId, `od_${id}_annual`, plan.annual, "year")).id,
  };
}

const existing = (await stripe.billingPortal.configurations.list({ limit: 100, active: true })).data;

/** A portal configuration for a plan and period: which prices it may move to. */
async function portal(name, offers) {
  const found = existing.find((configuration) => configuration.metadata?.od_portal === name);
  const params = {
    business_profile: { privacy_policy_url: `${origin}/`, terms_of_service_url: `${origin}/` },
    default_return_url: `${origin}/apps`,
    features: {
      invoice_history: { enabled: true },
      payment_method_update: { enabled: true },
      customer_update: { enabled: true, allowed_updates: ["email", "address", "name", "tax_id"] },
      subscription_cancel: { enabled: true, mode: "at_period_end", proration_behavior: "none" },
      subscription_update: {
        enabled: offers.length > 0,
        default_allowed_updates: ["price"],
        proration_behavior: "always_invoice",
        products: offers,
      },
    },
    metadata: { od_portal: name },
  };
  if (found) return stripe.billingPortal.configurations.update(found.id, params);
  return stripe.billingPortal.configurations.create(params);
}

const offer = (plan, ...which) => ({ product: prices[plan].product, prices: which.map((interval) => prices[plan][interval]) });

const portals = {
  standard: {
    // Monthly: Standard annual, or Team either way. Annual: Team annual.
    month: (await portal("standard_month", [offer("standard", "monthly", "annual"), offer("team", "monthly", "annual")])).id,
    year: (await portal("standard_year", [offer("standard", "annual"), offer("team", "annual")])).id,
  },
  team: {
    // Monthly: Team annual. Annual: nothing to switch to.
    month: (await portal("team_month", [offer("team", "monthly", "annual")])).id,
    year: (await portal("team_year", [])).id,
  },
};

const ids = Object.fromEntries(
  Object.keys(PLANS).map((id) => [id, { monthly: prices[id].monthly, annual: prices[id].annual, portal: portals[id] }]),
);
console.log(`plans: hostedPlans(${JSON.stringify(ids, null, 2)}),`);
