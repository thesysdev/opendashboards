import { sql } from "drizzle-orm";
import Stripe from "stripe";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { createBilling, type BillingPlan } from "@/lib/billing";
import { createDatabase } from "@/lib/db";
import { orgBilling, orgMembers, orgs, stripeEvents, users } from "@/lib/db/schema";

import { TEST_DATABASE_URL } from "./global-setup";

const { db, pool } = createDatabase(TEST_DATABASE_URL);

const SECRET = "whsec_test";
const ORG = "11111111-1111-4111-8111-111111111111";
const prices = (id: string) => ({ monthly: `price_${id}_m`, annual: `price_${id}_y`, portal: { month: "bpc_m", year: "bpc_y" } });
const PLANS: BillingPlan[] = [
  { id: "free", name: "Free", perSeat: false, stripe: null },
  { id: "standard", name: "Standard", perSeat: false, stripe: prices("standard") },
  { id: "team", name: "Team", perSeat: true, stripe: prices("team") },
];

/** Stripe's subscriptions as the fake returns them, by id. Webhook signatures are Stripe's own code. */
const subscriptions = new Map<string, unknown>();
const real = new Stripe("sk_test_unused");
const stripe = {
  webhooks: real.webhooks,
  subscriptions: { retrieve: async (id: string) => subscriptions.get(id) },
  customers: { update: async () => ({}) },
  checkout: { sessions: { retrieve: async () => ({}) } },
} as unknown as Stripe;

const billing = createBilling({
  db,
  stripe,
  plans: PLANS,
  freePlan: "free",
  webhookSecret: SECRET,
  origin: "http://localhost:3100",
  createWorkspace: async () => {
    throw new Error("not in these tests");
  },
});

function subscription(id: string, { status = "active", price = "price_team_m", quantity = 3 } = {}) {
  subscriptions.set(id, {
    id,
    status,
    customer: "cus_1",
    metadata: { org_id: ORG },
    cancel_at_period_end: false,
    items: { data: [{ id: `si_${id}`, price: { id: price }, quantity, current_period_end: 1_800_000_000 }] },
  });
}

/** Sends a signed webhook event, as Stripe would. */
async function deliver(eventId: string, type: string, object: { id: string }) {
  const payload = JSON.stringify({ id: eventId, object: "event", type, data: { object } });
  await billing.handleWebhook(payload, real.webhooks.generateTestHeaderString({ payload, secret: SECRET }));
}

beforeEach(async () => {
  subscriptions.clear();
  await db.execute(sql`TRUNCATE ${orgs}, ${users}, ${stripeEvents} CASCADE`);
  await db.insert(orgs).values({ id: ORG, name: "Acme", createdBy: "alice" });
  await db.insert(orgMembers).values({ orgId: ORG, userId: "alice", role: "admin", addedBy: "alice" });
  await db.insert(orgBilling).values({ orgId: ORG, stripeCustomerId: "cus_1", createdBy: "alice" });
});

afterAll(() => pool.end());

describe("webhooks", () => {
  it("refuses an event Stripe didn't sign", async () => {
    const payload = JSON.stringify({ id: "evt_x", type: "customer.subscription.updated", data: { object: { id: "sub_1" } } });
    await expect(billing.handleWebhook(payload, "t=1,v1=forged")).rejects.toThrow();
    expect(await billing.planOf(ORG)).toBe("free");
  });

  it("saves the plan and seats Stripe has now, whatever the event said", async () => {
    subscription("sub_1", { quantity: 3 });
    await deliver("evt_1", "customer.subscription.created", { id: "sub_1" });

    expect(await billing.planOf(ORG)).toBe("team");
    expect(await billing.seatsOf(ORG)).toBe(3);
    expect(await billing.subscription(ORG)).toMatchObject({ plan: "team", interval: "month", seats: 3, paymentFailed: false });
  });

  it("keeps the plan while a failed payment is retried, and moves to Free when the subscription ends", async () => {
    subscription("sub_1", { status: "past_due" });
    await deliver("evt_1", "invoice.payment_failed", { id: "in_1", parent: { subscription_details: { subscription: "sub_1" } } } as never);
    expect(await billing.planOf(ORG)).toBe("team");
    expect((await billing.subscription(ORG))?.paymentFailed).toBe(true);

    subscription("sub_1", { status: "canceled" });
    await deliver("evt_2", "customer.subscription.deleted", { id: "sub_1" });
    expect(await billing.planOf(ORG)).toBe("free");
    expect(await billing.seatsOf(ORG)).toBe(1);
  });

  it("handles a repeated event once", async () => {
    subscription("sub_1", { price: "price_standard_y", quantity: 1 });
    await deliver("evt_1", "customer.subscription.updated", { id: "sub_1" });
    subscription("sub_1", { status: "canceled" });
    await deliver("evt_1", "customer.subscription.updated", { id: "sub_1" });
    expect(await billing.planOf(ORG)).toBe("standard");
  });

  it("never lets an old subscription ending undo a newer one", async () => {
    subscription("sub_new");
    await deliver("evt_1", "customer.subscription.created", { id: "sub_new" });
    subscription("sub_old", { status: "canceled" });
    await deliver("evt_2", "customer.subscription.deleted", { id: "sub_old" });
    expect(await billing.planOf(ORG)).toBe("team");
  });
});
