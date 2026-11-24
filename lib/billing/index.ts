import { eq, sql } from "drizzle-orm";
import type Stripe from "stripe";

import type { StripePlan } from "@/config";
import type { Database } from "@/lib/db";
import { orgBilling, stripeEvents } from "@/lib/db/schema";

/*
 * Billing: a workspace's Stripe customer and subscription. It deals in plan
 * ids and seats bought, and knows nothing of what a plan allows, who the
 * members are or what they use: lib/plans joins it to enforcement.
 * Stripe is the source of truth: every change is read back from Stripe.
 */

/** Billing's view of a plan: what it's called and what it costs. Nothing about what it allows. */
export type BillingPlan = { id: string; name: string; perSeat: boolean; stripe: StripePlan | null };

export type Interval = "month" | "year";

/** A workspace's subscription, for the Billing section. */
export type SubscriptionSummary = {
  plan: string;
  interval: Interval;
  seats: number;
  currentPeriodEnd: Date | null;
  /** Cancelled, ending at `currentPeriodEnd`. */
  cancelAtPeriodEnd: boolean;
  /** The last payment failed and Stripe is retrying it. */
  paymentFailed: boolean;
};

/** What a new workspace bought at checkout needs to be created. */
export type PendingWorkspace = { name: string };

/** Statuses that keep a plan: past_due is a failed payment Stripe is still retrying. */
const LIVE = new Set<string>(["active", "trialing", "past_due"]);

/** An executor for the new-workspace callback: the database, or the transaction billing is in. */
type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];

export function createBilling(deps: {
  db: Database;
  stripe: Stripe;
  plans: BillingPlan[];
  freePlan: string;
  webhookSecret: string;
  /** Where people's browsers reach the app, for Stripe's return links. */
  origin: string;
  /** A checkout for a new workspace finished: create it, in `tx`, and return its id. */
  createWorkspace: (tx: Tx, input: { userId: string; pending: PendingWorkspace }) => Promise<string>;
}) {
  const { db, stripe } = deps;

  const planById = (id: string | null) => deps.plans.find((plan) => plan.id === id);

  /** The plan and interval of a Stripe price, if it's one of ours. */
  function planOfPrice(priceId: string): { plan: BillingPlan; interval: Interval } | null {
    for (const plan of deps.plans) {
      if (plan.stripe?.monthly === priceId) return { plan, interval: "month" };
      if (plan.stripe?.annual === priceId) return { plan, interval: "year" };
    }
    return null;
  }

  async function rowOf(orgId: string) {
    const [row] = await db.select().from(orgBilling).where(eq(orgBilling.orgId, orgId)).limit(1);
    return row ?? null;
  }

  /** The workspace's live subscription row, or null on the free plan. */
  async function live(orgId: string) {
    const row = await rowOf(orgId);
    return row?.plan && row.status && LIVE.has(row.status) && planById(row.plan) ? row : null;
  }

  /** The workspace's Stripe customer, created the first time it's needed. */
  async function customerFor(orgId: string, userId: string): Promise<string> {
    const existing = await rowOf(orgId);
    if (existing) return existing.stripeCustomerId;
    const customer = await stripe.customers.create({ metadata: { org_id: orgId } }, { idempotencyKey: `customer:${orgId}` });
    await db.insert(orgBilling).values({ orgId, stripeCustomerId: customer.id, createdBy: userId }).onConflictDoNothing();
    return (await rowOf(orgId))!.stripeCustomerId;
  }

  /**
   * Reads a subscription back from Stripe and saves it on its workspace. Safe
   * to repeat and order-free: whatever Stripe says now wins.
   */
  async function sync(subscriptionId: string, orgIdHint?: string): Promise<void> {
    const subscription = await stripe.subscriptions.retrieve(subscriptionId);
    const customerId = typeof subscription.customer === "string" ? subscription.customer : subscription.customer.id;
    const [byCustomer] = await db.select().from(orgBilling).where(eq(orgBilling.stripeCustomerId, customerId)).limit(1);
    const orgId = byCustomer?.orgId ?? orgIdHint ?? subscription.metadata?.org_id;
    if (!orgId) return;
    const current = byCustomer ?? (await rowOf(orgId));
    const isLive = LIVE.has(subscription.status);
    // An older subscription ending never undoes a newer one.
    if (current?.stripeSubscriptionId && current.stripeSubscriptionId !== subscription.id && !isLive) return;

    const item = subscription.items.data[0];
    const priced = item ? planOfPrice(item.price.id) : null;
    const periodEnd = (item as { current_period_end?: number } | undefined)?.current_period_end ??
      (subscription as unknown as { current_period_end?: number }).current_period_end;
    const values = {
      stripeCustomerId: customerId,
      stripeSubscriptionId: subscription.id,
      plan: isLive && priced ? priced.plan.id : null,
      interval: priced?.interval ?? null,
      status: subscription.status,
      seats: item?.quantity ?? 1,
      currentPeriodEnd: periodEnd ? new Date(periodEnd * 1000) : null,
      cancelAtPeriodEnd: Boolean(subscription.cancel_at_period_end || subscription.cancel_at),
      updatedAt: new Date(),
    };
    await db
      .insert(orgBilling)
      .values({ orgId, createdBy: subscription.metadata?.user_id ?? "stripe", ...values })
      .onConflictDoUpdate({ target: orgBilling.orgId, set: values });
  }

  /**
   * A finished checkout: for a new workspace, creates it (once, however many
   * times this runs) and attaches the customer; then saves the subscription.
   * Returns the workspace's id.
   */
  async function completeSession(session: Stripe.Checkout.Session): Promise<string | null> {
    if (session.mode !== "subscription" || session.status !== "complete") return null;
    const customerId = typeof session.customer === "string" ? session.customer : session.customer?.id;
    const subscriptionId = typeof session.subscription === "string" ? session.subscription : session.subscription?.id;
    if (!customerId || !subscriptionId) return null;
    let orgId: string | null = session.metadata?.org_id || null;
    if (!orgId) {
      const userId = session.metadata?.user_id;
      const name = session.metadata?.workspace_name;
      if (!userId || !name) return null;
      orgId = await db.transaction(async (tx) => {
        // The webhook and the browser's return can arrive together: one creates the workspace.
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`checkout:${session.id}`}))`);
        const [existing] = await tx.select({ orgId: orgBilling.orgId }).from(orgBilling).where(eq(orgBilling.stripeCustomerId, customerId)).limit(1);
        if (existing) return existing.orgId;
        const created = await deps.createWorkspace(tx, { userId, pending: { name } });
        await tx.insert(orgBilling).values({ orgId: created, stripeCustomerId: customerId, createdBy: userId });
        return created;
      });
      await stripe.customers.update(customerId, { metadata: { org_id: orgId } });
    }
    await sync(subscriptionId, orgId);
    return orgId;
  }

  async function portalSession(orgId: string, returnPath: string, flow?: Stripe.BillingPortal.SessionCreateParams.FlowData) {
    const row = await rowOf(orgId);
    if (!row) throw new Error("This workspace has no billing account yet.");
    const plan = row.plan && row.status && LIVE.has(row.status) ? planById(row.plan) : undefined;
    const session = await stripe.billingPortal.sessions.create({
      customer: row.stripeCustomerId,
      // The workspace's plan decides what the portal offers: Standard can move to Team, nothing moves down.
      configuration: plan?.stripe && row.interval ? plan.stripe.portal[row.interval] : undefined,
      return_url: `${deps.origin}${returnPath}`,
      ...(flow ? { flow_data: flow } : {}),
    });
    return { url: session.url };
  }

  return {
    async planOf(orgId: string): Promise<string> {
      return (await live(orgId))?.plan ?? deps.freePlan;
    },

    /** Seats bought; 1 for a plan that isn't per seat. */
    async seatsOf(orgId: string): Promise<number> {
      const row = await live(orgId);
      return row && planById(row.plan)?.perSeat ? row.seats : 1;
    },

    async subscription(orgId: string): Promise<SubscriptionSummary | null> {
      const row = await live(orgId);
      if (!row?.plan || !row.interval) return null;
      return {
        plan: row.plan,
        interval: row.interval,
        seats: row.seats,
        currentPeriodEnd: row.currentPeriodEnd,
        cancelAtPeriodEnd: row.cancelAtPeriodEnd,
        paymentFailed: row.status === "past_due",
      };
    },

    /** Whether the workspace has a billing account to manage (it once paid, or started to). */
    async hasAccount(orgId: string): Promise<boolean> {
      return (await rowOf(orgId)) !== null;
    },

    /**
     * Stripe Checkout for a plan. With `orgId` null it's for a new workspace,
     * created when the checkout completes. `minSeats` is the least a per-seat
     * plan may be bought with: the seats already in use.
     */
    async startCheckout(input: {
      orgId: string | null;
      planId: string;
      interval: Interval;
      seats: number;
      minSeats: number;
      userId: string;
      pending?: PendingWorkspace;
      cancelPath: string;
    }): Promise<{ url: string }> {
      const plan = planById(input.planId);
      if (!plan?.stripe) throw new Error(`Plan ${input.planId} can't be bought`);
      const customer = input.orgId ? await customerFor(input.orgId, input.userId) : undefined;
      const metadata: Record<string, string> = { user_id: input.userId };
      if (input.orgId) metadata.org_id = input.orgId;
      if (input.pending) metadata.workspace_name = input.pending.name;
      const session = await stripe.checkout.sessions.create({
        mode: "subscription",
        customer,
        customer_update: customer ? { address: "auto", name: "auto" } : undefined,
        line_items: [
          {
            price: input.interval === "year" ? plan.stripe.annual : plan.stripe.monthly,
            quantity: plan.perSeat ? Math.max(input.seats, input.minSeats, 1) : 1,
            adjustable_quantity: plan.perSeat ? { enabled: true, minimum: Math.max(input.minSeats, 1), maximum: 999 } : undefined,
          },
        ],
        automatic_tax: { enabled: true },
        billing_address_collection: "required",
        tax_id_collection: { enabled: true },
        subscription_data: { metadata },
        metadata,
        success_url: `${deps.origin}/api/billing/checkout-complete?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${deps.origin}${input.cancelPath}`,
      });
      if (!session.url) throw new Error("Stripe returned a checkout without a URL");
      return { url: session.url };
    },

    /**
     * The browser came back from a checkout: saves it now, without waiting
     * for the webhook, so new limits apply at once. Only for whoever started
     * it. Returns the workspace's id.
     */
    async completeCheckout(sessionId: string, userId: string): Promise<string | null> {
      const session = await stripe.checkout.sessions.retrieve(sessionId);
      if (session.metadata?.user_id !== userId) return null;
      return completeSession(session);
    },

    /** Stripe's page to confirm a new seat count, showing the prorated price. The caller checked it's not below what's in use. */
    async changeSeats(orgId: string, seats: number, returnPath: string): Promise<{ url: string }> {
      const row = await live(orgId);
      if (!row?.stripeSubscriptionId || !planById(row.plan)?.perSeat) throw new Error("This workspace isn't on a per-seat plan");
      const subscription = await stripe.subscriptions.retrieve(row.stripeSubscriptionId);
      const item = subscription.items.data[0];
      if (!item) throw new Error("The subscription has no items");
      return portalSession(orgId, returnPath, {
        type: "subscription_update_confirm",
        subscription_update_confirm: { subscription: subscription.id, items: [{ id: item.id, quantity: seats }] },
        after_completion: { type: "redirect", redirect: { return_url: `${deps.origin}${returnPath}` } },
      });
    },

    /** Stripe's portal: invoices, card, billing details, tax ID, switching plan or period where allowed, cancelling. */
    openPortal(orgId: string, returnPath: string): Promise<{ url: string }> {
      return portalSession(orgId, returnPath);
    },

    /** The workspace is being deleted: its subscription ends now, with nothing left to bill. */
    async cancelNow(orgId: string): Promise<void> {
      const row = await rowOf(orgId);
      if (!row?.stripeSubscriptionId || !row.status || !LIVE.has(row.status)) return;
      await stripe.subscriptions.cancel(row.stripeSubscriptionId);
    },

    /** A Stripe webhook: verified, then each event read back from Stripe. A repeated event is skipped. */
    async handleWebhook(rawBody: string, signature: string): Promise<void> {
      const event = stripe.webhooks.constructEvent(rawBody, signature, deps.webhookSecret);
      const [seen] = await db.select({ id: stripeEvents.id }).from(stripeEvents).where(eq(stripeEvents.id, event.id)).limit(1);
      if (seen) return;
      const object = event.data.object as unknown as Record<string, unknown>;
      switch (event.type) {
        case "checkout.session.completed":
          await completeSession(await stripe.checkout.sessions.retrieve(object.id as string));
          break;
        case "customer.subscription.created":
        case "customer.subscription.updated":
        case "customer.subscription.deleted":
          await sync(object.id as string);
          break;
        case "invoice.paid":
        case "invoice.payment_failed": {
          const subscriptionId = invoiceSubscription(object);
          if (subscriptionId) await sync(subscriptionId);
          break;
        }
      }
      // Recorded once handled: an event that failed half way is handled again when Stripe retries it.
      await db.insert(stripeEvents).values({ id: event.id, type: event.type }).onConflictDoNothing();
    },
  };
}

export type Billing = ReturnType<typeof createBilling>;

/** An invoice's subscription, wherever this API version keeps it. */
function invoiceSubscription(invoice: Record<string, unknown>): string | null {
  const parent = invoice.parent as { subscription_details?: { subscription?: unknown } } | undefined;
  const id = parent?.subscription_details?.subscription ?? invoice.subscription;
  if (typeof id === "string") return id;
  return id && typeof id === "object" && "id" in id ? String((id as { id: unknown }).id) : null;
}
