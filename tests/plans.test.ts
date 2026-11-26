import { randomUUID } from "node:crypto";

import { sql } from "drizzle-orm";
import Stripe from "stripe";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { hostedPlans } from "@/config/plans";
import { createAppService } from "@/lib/apps/service";
import type { Billing } from "@/lib/billing";
import { createDatabase } from "@/lib/db";
import { apps, dataConnections, orgs, users } from "@/lib/db/schema";
import { createEnforcement } from "@/lib/entitlements";
import { createOrgService } from "@/lib/orgs/service";
import { createPlans } from "@/lib/plans/plans";

import { TEST_DATABASE_URL } from "./global-setup";

const { db, pool } = createDatabase(TEST_DATABASE_URL);

const stripeIds = { monthly: "price_m", annual: "price_y", portal: { month: "bpc_m", year: "bpc_y" } };
const settings = hostedPlans({ standard: stripeIds, team: { ...stripeIds, monthly: "price_tm", annual: "price_ty" } });

/** Billing as the plans see it, without Stripe: each workspace's plan and seats are set by the test. */
const subscribed = new Map<string, { plan: string; seats: number }>();
const billing = {
  planOf: async (orgId: string) => subscribed.get(orgId)?.plan ?? "free",
  seatsOf: async (orgId: string) => subscribed.get(orgId)?.seats ?? 1,
  changeSeats: async () => ({ url: "https://billing.stripe.test/confirm" }),
  startCheckout: vi.fn(async () => ({ url: "https://checkout.stripe.test" })),
} as unknown as Billing;

const track = vi.fn();
const plans = createPlans({ db, settings, billing, track });
const orgService = createOrgService({ db, gate: plans.gate });
const appService = createAppService({ db, gate: plans.gate });

const alice = { id: "alice", email: "alice@example.com" };

async function workspace(): Promise<string> {
  const created = await orgService.create(alice, { name: "Acme" });
  if (!created.ok) throw new Error(created.error.message);
  return created.data.id;
}

async function addApps(orgId: string, n: number) {
  for (let i = 0; i < n; i++) await db.insert(apps).values({ userId: alice.id, orgId, name: `App ${i}` });
}

async function addConnection(orgId: string, demoDataset: string | null = null) {
  const id = randomUUID();
  await db.insert(dataConnections).values({
    id,
    userId: alice.id,
    orgId,
    name: "Shop",
    type: "postgres",
    config: { type: "postgres", host: "db.example.com", port: 5432, database: "shop", user: "reader", sslMode: "require" },
    secret: demoDataset ? null : { v: 1, provider: "none" },
    credentialHint: "…",
    demoDataset,
    status: "ok",
    lastCheckedAt: new Date(),
  });
  return id;
}

beforeEach(async () => {
  subscribed.clear();
  track.mockClear();
  await db.execute(sql`TRUNCATE ${apps}, ${dataConnections}, ${orgs}, ${users} CASCADE`);
  await orgService.ensureUser(alice);
});

afterAll(() => pool.end());

describe("usage", () => {
  it("counts admin and editor invites as editors, and leaves sample data out of connections", async () => {
    const orgId = await workspace();
    subscribed.set(orgId, { plan: "team", seats: 5 });
    await orgService.invite(alice.id, { orgId, email: "bob@example.com", role: "editor" });
    await orgService.invite(alice.id, { orgId, email: "vic@example.com", role: "viewer" });
    await addConnection(orgId);
    await addConnection(orgId, "retail");

    const limits = await plans.getLimits(orgId);
    expect(limits.editors).toEqual({ used: 2, max: 5 });
    expect(limits.connections).toEqual({ used: 1, max: 25 });
  });
});

describe("at a limit", () => {
  it("refuses the sixth app on Free, and suggests the plan with more", async () => {
    const orgId = await workspace();
    await addApps(orgId, 5);
    const connectionId = await addConnection(orgId);

    const created = await appService.create({ userId: alice.id, orgId }, { prompt: "Revenue by month", connectionIds: [connectionId] });

    expect(created).toEqual({ ok: false, error: { code: "plan_limit", message: "5 of 5 apps on Free. Upgrade to Standard for 25." } });
  });

  it("allows the app again once one is deleted", async () => {
    const orgId = await workspace();
    await addApps(orgId, 4);
    const connectionId = await addConnection(orgId);
    expect((await appService.create({ userId: alice.id, orgId }, { prompt: "Revenue", connectionIds: [connectionId] })).ok).toBe(true);
  });

  it("holds a seat for an invite, and says to add one when they're all in use", async () => {
    const orgId = await workspace();
    subscribed.set(orgId, { plan: "team", seats: 2 });
    expect((await orgService.invite(alice.id, { orgId, email: "bob@example.com", role: "editor" })).ok).toBe(true);

    const third = await orgService.invite(alice.id, { orgId, email: "carol@example.com", role: "editor" });
    expect(third).toMatchObject({ ok: false, error: { code: "plan_limit", message: "All 2 seats are in use. Add a seat in Billing." } });
    // Inviting bob again changes nothing: his invite already holds its seat.
    expect((await orgService.invite(alice.id, { orgId, email: "bob@example.com", role: "admin" })).ok).toBe(true);
  });

  it("has no viewers without the viewer role", async () => {
    const orgId = await workspace();
    const invited = await orgService.invite(alice.id, { orgId, email: "vic@example.com", role: "viewer" });
    expect(invited).toMatchObject({ ok: false, error: { message: "Viewers come with the Team plan. Upgrade to Team in Billing." } });
  });
});

describe("view-only", () => {
  it("blocks building in a workspace over its plan, and lifts once it fits again", async () => {
    const orgId = await workspace();
    await addApps(orgId, 6); // More than Free allows: a Standard plan that ended.

    const verdict = await plans.enforcement.enforce(db, orgId, "renameApp");
    expect(verdict).toEqual({ ok: false, denial: { reason: "viewOnly", over: [{ name: "apps", usage: 6, max: 5 }] } });
    expect(await plans.describeDenial(orgId, verdict.ok ? (null as never) : verdict.denial)).toBe(
      "This workspace is over the Free plan's limits, so it's view-only. Delete apps or connections, or upgrade.",
    );

    await db.execute(sql`DELETE FROM ${apps} WHERE ${apps.id} = (SELECT id FROM ${apps} LIMIT 1)`);
    expect(await plans.enforcement.enforce(db, orgId, "renameApp")).toEqual({ ok: true });
  });
});

describe("seats", () => {
  it("never goes below the seats in use", async () => {
    const orgId = await workspace();
    subscribed.set(orgId, { plan: "team", seats: 3 });
    await orgService.invite(alice.id, { orgId, email: "bob@example.com", role: "editor" });

    expect(await plans.changeSeats(orgId, 1)).toEqual({
      ok: false,
      message: "2 seats are in use. To go lower, first remove an editor, make them a viewer, or revoke an invite.",
    });
    expect(await plans.changeSeats(orgId, 2)).toEqual({ ok: true, url: "https://billing.stripe.test/confirm" });
  });
});

describe("upgrade fit", () => {
  it("refuses a plan that would leave the workspace view-only, and allows one that fits", async () => {
    const orgId = await workspace();
    subscribed.set(orgId, { plan: "team", seats: 3 });
    await orgService.invite(alice.id, { orgId, email: "bob@example.com", role: "editor" });
    await orgService.invite(alice.id, { orgId, email: "carol@example.com", role: "editor" });
    subscribed.set(orgId, { plan: "free", seats: 1 });

    expect(await plans.upgrade(orgId, { planId: "standard", interval: "month", userId: alice.id })).toEqual({
      ok: false,
      message: "Standard allows 1 editor. You have 3, so the workspace would stay view-only. Choose a plan that fits, or remove 2 editors first.",
    });
    expect(await plans.upgrade(orgId, { planId: "team", interval: "month", userId: alice.id })).toEqual({
      ok: true,
      url: "https://checkout.stripe.test",
    });
  });
});

describe("one Free workspace per person", () => {
  it("lets someone create a second Free workspace only once their first is paid for", async () => {
    const [first] = await orgService.list(alice.id);
    expect(await plans.mayCreateFree(alice.id)).toBe(false);
    subscribed.set(first!.id, { plan: "standard", seats: 1 });
    expect(await plans.mayCreateFree(alice.id)).toBe(true);
  });
});

describe("billing off", () => {
  it("allows everything", async () => {
    const orgId = await workspace();
    await addApps(orgId, 50);
    expect(await createEnforcement().enforce(db, orgId, "createApp")).toEqual({ ok: true });
  });
});

describe("analytics", () => {
  it("records a refusal once, against who asked, with ids and labels only", async () => {
    const orgId = await workspace();
    await addApps(orgId, 5);
    const connectionId = await addConnection(orgId);
    track.mockClear();

    await appService.create({ userId: alice.id, orgId }, { prompt: "Revenue by month", connectionIds: [connectionId] });

    expect(track).toHaveBeenCalledTimes(1);
    expect(track).toHaveBeenCalledWith(alice.id, "plan_limit_hit", { plan_id: "free", limit: "apps", operation: "createApp", surface: "apps" }, orgId);
    expect(JSON.stringify(track.mock.calls)).not.toMatch(/@|Acme|Revenue/);
  });

  it("names the switch or view-only that refused, and records nothing for a check nobody asked for", async () => {
    const orgId = await workspace();
    await orgService.invite(alice.id, { orgId, email: "vic@example.com", role: "viewer" });
    expect(track).toHaveBeenLastCalledWith(alice.id, "plan_limit_hit", expect.objectContaining({ limit: "viewerRole", surface: "members" }), orgId);

    await addApps(orgId, 6);
    track.mockClear();
    expect(await plans.gate(db, orgId, "editDashboard", null)).not.toBeNull();
    expect(track).not.toHaveBeenCalled();
    await plans.gate(db, orgId, "chat", alice.id);
    expect(track).toHaveBeenCalledWith(alice.id, "plan_limit_hit", expect.objectContaining({ limit: "view_only", surface: "chat" }), orgId);
  });

  it("records a checkout started, or failed with Stripe's code", async () => {
    const orgId = await workspace();
    track.mockClear();
    await plans.upgrade(orgId, { planId: "team", interval: "year", userId: alice.id });
    expect(track).toHaveBeenCalledWith(
      alice.id,
      "checkout_started",
      { from_plan: "free", to_plan: "team", interval: "annual", seats: 1, new_workspace: false },
      orgId,
    );

    vi.mocked(billing.startCheckout).mockRejectedValueOnce(
      new Stripe.errors.StripeInvalidRequestError({ type: "invalid_request_error", code: "resource_missing", message: "No such price: 'price_tm'" }),
    );
    await expect(plans.upgrade(orgId, { planId: "team", interval: "month", userId: alice.id })).rejects.toThrow();
    expect(track).toHaveBeenLastCalledWith(
      alice.id,
      "checkout_failed",
      { to_plan: "team", interval: "monthly", error_code: "resource_missing", new_workspace: false },
      orgId,
    );
    expect(track).toHaveBeenCalledTimes(2);

    // Not Stripe's: a database error's code isn't passed off as one.
    vi.mocked(billing.startCheckout).mockRejectedValueOnce(Object.assign(new Error("duplicate key"), { code: "23505" }));
    await expect(plans.upgrade(orgId, { planId: "team", interval: "month", userId: alice.id })).rejects.toThrow();
    expect(track).toHaveBeenLastCalledWith(alice.id, "checkout_failed", expect.objectContaining({ error_code: "unknown" }), orgId);
  });
});
