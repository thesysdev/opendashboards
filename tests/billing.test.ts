import { sql } from "drizzle-orm";
import Stripe from "stripe";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { createBilling, type BillingPlan } from "@/lib/billing";
import { createDatabase } from "@/lib/db";
import { orgBilling, orgMembers, orgs, stripeEvents, users } from "@/lib/db/schema";

import { TEST_DATABASE_URL } from "./global-setup";

const { db, pool } = createDatabase(TEST_DATABASE_URL);

const SECRET = "whsec_test";
const ORG = "11111111-1111-4111-8111-111111111111";
const NEW_ORG = "22222222-2222-4222-8222-222222222222";
const prices = (id: string) => ({ monthly: `price_${id}_m`, annual: `price_${id}_y`, portal: { month: "bpc_m", year: "bpc_y" } });
const PLANS: BillingPlan[] = [
  { id: "free", name: "Free", perSeat: false, stripe: null },
  { id: "standard", name: "Standard", perSeat: false, stripe: prices("standard") },
  { id: "team", name: "Team", perSeat: true, stripe: prices("team") },
];

/** Stripe's subscriptions as the fake returns them, by id. Webhook signatures are Stripe's own code. */
const subscriptions = new Map<string, unknown>();
const real = new Stripe("sk_test_unused");
const createCustomer = vi.fn();
const updateCustomer = vi.fn();
const createCheckout = vi.fn();
const retrieveCheckout = vi.fn();
const createWorkspace = vi.fn<Parameters<typeof createBilling>[0]["createWorkspace"]>();
const onChange = vi.fn<NonNullable<Parameters<typeof createBilling>[0]["onChange"]>>();
const stripe = {
  webhooks: real.webhooks,
  subscriptions: { retrieve: async (id: string) => subscriptions.get(id) },
  customers: { create: createCustomer, update: updateCustomer },
  checkout: { sessions: { create: createCheckout, retrieve: retrieveCheckout } },
} as unknown as Stripe;

const billing = createBilling({
  db,
  stripe,
  plans: PLANS,
  freePlan: "free",
  webhookSecret: SECRET,
  origin: "http://localhost:3100",
  createWorkspace,
  onChange,
});

function subscription(id: string, { status = "active", price = "price_team_m", quantity = 3, customer = "cus_1", cancelAtPeriodEnd = false } = {}) {
  subscriptions.set(id, {
    id,
    status,
    customer,
    metadata: { org_id: ORG, user_id: "bob" },
    cancel_at_period_end: cancelAtPeriodEnd,
    items: { data: [{ id: `si_${id}`, price: { id: price }, quantity, current_period_end: 1_800_000_000 }] },
  });
}

/** Sends a signed webhook event, as Stripe would. */
async function deliver(eventId: string, type: string, object: { id: string } & Record<string, unknown>) {
  const payload = JSON.stringify({ id: eventId, object: "event", type, data: { object } });
  await billing.handleWebhook(payload, real.webhooks.generateTestHeaderString({ payload, secret: SECRET }));
}

beforeEach(async () => {
  vi.resetAllMocks();
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
    await deliver("evt_1", "invoice.payment_failed", { id: "in_1", parent: { subscription_details: { subscription: "sub_1" } } });
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

  it("ignores another product's subscription and invoice even when its org metadata matches", async () => {
    subscription("sub_foreign", { customer: "cus_foreign" });
    await deliver("evt_sub", "customer.subscription.updated", { id: "sub_foreign" });
    await deliver("evt_invoice", "invoice.paid", { id: "in_foreign", subscription: "sub_foreign" });

    expect(await billing.planOf(ORG)).toBe("free");
    expect(await db.select().from(stripeEvents)).toEqual([]);
  });

  it("ignores a foreign Checkout without creating or updating a workspace", async () => {
    retrieveCheckout.mockResolvedValue({
      ...completedCheckout,
      metadata: { user_id: "alice", workspace_name: "Foreign" },
    });

    await deliver("evt_checkout", "checkout.session.completed", { id: "cs_new" });
    expect(await billing.completeCheckout("cs_new", "alice")).toBeNull();
    expect(createWorkspace).not.toHaveBeenCalled();
    expect(updateCustomer).not.toHaveBeenCalled();
    expect(await db.select().from(stripeEvents)).toEqual([]);
  });

  it("links and syncs a tagged paid workspace once Checkout has completed", async () => {
    subscription("sub_new", { customer: "cus_new" });
    retrieveCheckout.mockResolvedValue({
      ...completedCheckout,
      metadata: { product: "opendashboards", user_id: "alice", workspace_name: "New" },
    });
    createWorkspace.mockImplementationOnce(async (tx, { userId, pending }) => {
      await tx.insert(orgs).values({ id: NEW_ORG, name: pending.name, createdBy: userId });
      return NEW_ORG;
    });

    await deliver("evt_sub", "customer.subscription.created", { id: "sub_new" });
    await deliver("evt_checkout", "checkout.session.completed", { id: "cs_new" });
    expect(await billing.completeCheckout("cs_new", "alice")).toBe(NEW_ORG);
    expect(createWorkspace).toHaveBeenCalledTimes(1);
    expect(await billing.planOf(NEW_ORG)).toBe("team");
  });
});

const completedCheckout = {
  id: "cs_new",
  mode: "subscription",
  status: "complete",
  customer: "cus_new",
  subscription: "sub_new",
};

describe("subscription changes", () => {
  const kinds = () => onChange.mock.calls.map(([change]) => change.kind);

  it("tells each real change once, whichever events and retries bring it", async () => {
    subscription("sub_1", { quantity: 3 });
    await deliver("evt_1", "customer.subscription.created", { id: "sub_1" });
    await deliver("evt_1", "customer.subscription.created", { id: "sub_1" }); // Stripe retrying
    await deliver("evt_2", "invoice.paid", { id: "in_1", parent: { subscription_details: { subscription: "sub_1" } } }); // Same state
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith({
      kind: "started",
      orgId: ORG,
      userId: "bob",
      plan: "team",
      previousPlan: "free",
      interval: "month",
      seats: 3,
      previousSeats: 1,
      status: "active",
      cancelAtPeriodEnd: false,
    });

    subscription("sub_1", { quantity: 5 });
    await deliver("evt_3", "customer.subscription.updated", { id: "sub_1" });
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ kind: "changed", seats: 5, previousSeats: 3 }));

    subscription("sub_1", { quantity: 5, cancelAtPeriodEnd: true });
    await deliver("evt_4", "customer.subscription.updated", { id: "sub_1" });
    subscription("sub_1", { status: "canceled", quantity: 5 });
    await deliver("evt_5", "customer.subscription.deleted", { id: "sub_1" });
    expect(kinds()).toEqual(["started", "changed", "changed", "cancelled"]);
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ kind: "cancelled", plan: "free", previousPlan: "team", status: "canceled" }));
  });

  it("tells a start once when the browser's return and the webhook arrive together", async () => {
    subscription("sub_1");
    retrieveCheckout.mockResolvedValue({
      id: "cs_1",
      mode: "subscription",
      status: "complete",
      customer: "cus_1",
      subscription: "sub_1",
      metadata: { product: "opendashboards", org_id: ORG, user_id: "bob" },
    });
    await Promise.all([billing.completeCheckout("cs_1", "bob"), deliver("evt_1", "checkout.session.completed", { id: "cs_1" })]);
    expect(kinds()).toEqual(["started"]);
  });
});

describe("Checkout ownership", () => {
  it.each([ORG, null])("tags the customer, session, and subscription with orgId %s", async (orgId) => {
    if (orgId) await db.delete(orgBilling);
    createCustomer.mockResolvedValue({ id: "cus_new" });
    createCheckout.mockResolvedValue({ url: "https://checkout.stripe.com/test" });

    await billing.startCheckout({
      orgId, planId: "team", interval: "month", seats: 2, minSeats: 1,
      userId: "alice", pending: orgId ? undefined : { name: "New" }, cancelPath: "/apps",
    });

    expect(createCustomer.mock.calls[0]?.[0]).toEqual({
      metadata: { product: "opendashboards", ...(orgId ? { org_id: orgId } : {}) },
    });
    const metadata = {
      product: "opendashboards", user_id: "alice", ...(orgId ? { org_id: orgId } : { workspace_name: "New" }),
    };
    expect(createCheckout).toHaveBeenCalledWith(expect.objectContaining({
      customer: "cus_new", metadata, subscription_data: { metadata },
    }));
  });

  it("tags a reused customer before creating a Checkout session", async () => {
    createCheckout.mockResolvedValue({ url: "https://checkout.stripe.com/test" });

    await billing.startCheckout({
      orgId: ORG, planId: "team", interval: "month", seats: 2, minSeats: 1,
      userId: "alice", cancelPath: "/apps",
    });

    expect(createCustomer).not.toHaveBeenCalled();
    expect(updateCustomer).toHaveBeenCalledWith("cus_1", { metadata: { product: "opendashboards" } });
    expect(updateCustomer.mock.invocationCallOrder[0]).toBeLessThan(createCheckout.mock.invocationCallOrder[0]);
  });
});
