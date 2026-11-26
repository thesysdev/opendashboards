"use server";

import { z } from "zod";

import { track } from "@/lib/analytics";
import { getDb } from "@/lib/db";
import { logError } from "@/lib/log";
import { requireKnownUser } from "@/lib/orgs";
import { workspaceFacts } from "@/lib/orgs/access";
import { decide } from "@/lib/orgs/policy";
import { getPlans, type Plans } from "@/lib/plans";

/*
 * The Billing section's buttons. Each sends the browser to a Stripe page:
 * Checkout, or the portal. Admins only, checked against the database.
 */

/** Where to send the browser, or what to tell the admin. */
export type BillingResult = { ok: true; url: string } | { ok: false; message: string };

const SOMETHING_WRONG: BillingResult = { ok: false, message: "Stripe couldn't start this. Try again, or email support@thesys.dev." };

const orgSchema = z.object({ orgId: z.uuid() });
const upgradeSchema = orgSchema.extend({ planId: z.string().min(1).max(40), interval: z.enum(["month", "year"]) });
const seatsSchema = orgSchema.extend({ seats: z.number().int() });

/** The billing an admin may manage, or why not. */
async function managed<T extends { orgId: string }>(
  schema: z.ZodType<T>,
  input: unknown,
): Promise<{ error: BillingResult } | { user: { id: string }; plans: Plans; input: T }> {
  const user = await requireKnownUser();
  const plans = getPlans();
  const parsed = schema.safeParse(input);
  if (!plans || !parsed.success) return { error: { ok: false, message: "Billing isn't available." } };
  const managing = decide("billing", "update", await workspaceFacts(getDb(), user.id, parsed.data.orgId));
  if (!managing.allowed) return { error: { ok: false, message: managing.reason } };
  return { user, plans, input: parsed.data };
}

async function stripeCall(operation: string, call: () => Promise<BillingResult>): Promise<BillingResult> {
  try {
    return await call();
  } catch (error) {
    logError(`billing.${operation}`, error);
    return SOMETHING_WRONG;
  }
}

/** Stripe Checkout, for a workspace on the free plan. */
export async function upgradeAction(input: unknown): Promise<BillingResult> {
  const found = await managed(upgradeSchema, input);
  if ("error" in found) return found.error;
  const { plans, user, input: data } = found;
  return stripeCall("upgrade", () => plans.upgrade(data.orgId, { planId: data.planId, interval: data.interval, userId: user.id }));
}

/** Stripe's portal: invoices, card, billing details, tax ID, switching plan or period, cancelling. */
export async function manageBillingAction(input: unknown): Promise<BillingResult> {
  const found = await managed(orgSchema, input);
  if ("error" in found) return found.error;
  const { plans, user, input: data } = found;
  return stripeCall("portal", async () => {
    const { url } = await plans.billing.openPortal(data.orgId, `/w/${data.orgId}/settings#billing`);
    track(user.id, "billing_portal_opened", { plan_id: await plans.billing.planOf(data.orgId) }, data.orgId);
    return { ok: true, url };
  });
}

/** Stripe's page to confirm a new seat count, never below the seats in use. */
export async function changeSeatsAction(input: unknown): Promise<BillingResult> {
  const found = await managed(seatsSchema, input);
  if ("error" in found) return found.error;
  const { plans, user, input: data } = found;
  return stripeCall("seats", async () => {
    const from = await plans.billing.seatsOf(data.orgId);
    const result = await plans.changeSeats(data.orgId, data.seats);
    // Only Stripe's confirm page so far: seats_changed is recorded when Stripe says it's done.
    if (result.ok) track(user.id, "seats_change_started", { from_seats: from, to_seats: data.seats }, data.orgId);
    return result;
  });
}
