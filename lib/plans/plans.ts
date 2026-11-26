import { and, eq } from "drizzle-orm";
import Stripe from "stripe";

import type { CatalogPlan, PlansSettings } from "@/config";
import type { Billing, Interval } from "@/lib/billing";
import { intervalLabel } from "@/lib/analytics-labels";
import type { Database } from "@/lib/db";
import { orgs } from "@/lib/db/schema";
import {
  createEnforcement,
  isViewOnly,
  type Denial,
  type Enforcement,
  type Entitlements,
  type Gate,
  type LimitName,
  type Limits,
  type Operation,
  type SwitchName,
} from "@/lib/entitlements";

/*
 * Plans: the one place that knows both what a plan costs (billing) and what
 * it allows (enforcement). It turns a workspace's plan into entitlements,
 * words refusals, and holds the rules that need both: seats never below
 * what's in use, and one Free workspace per person.
 */

const NOUNS: Record<LimitName, [one: string, many: string]> = {
  editors: ["editor", "editors"],
  connections: ["connection", "connections"],
  apps: ["app", "apps"],
};
const SWITCHES: Record<SwitchName, string> = { viewerRole: "Viewers" };

const noun = (name: LimitName, count: number) => NOUNS[name][count === 1 ? 0 : 1];

/** Records a product event (lib/analytics' `track`): ids, counts and fixed labels only. */
export type Track = (userId: string, event: string, properties: Record<string, unknown>, orgId: string | null) => void;

/** Where in the product each gated operation is, for plan_limit_hit's `surface`. */
const SURFACES: Record<Operation, string> = {
  createApp: "apps",
  renameApp: "apps",
  addAppConnection: "apps",
  createConnection: "connections",
  renameConnection: "connections",
  addEditor: "members",
  addViewer: "members",
  chat: "chat",
  editDashboard: "dashboards",
};

/** Which limit refused: a limit's name, `viewerRole`, or `view_only` for a workspace already over its plan. */
const limitOf = (denial: Denial): string => (denial.reason === "viewOnly" ? "view_only" : denial.name);

/** Stripe's error code (e.g. resource_missing), or "unknown" for anything else. Never the message: it can carry ids and amounts. */
const stripeCode = (error: unknown): string =>
  error instanceof Stripe.errors.StripeError && typeof error.code === "string" ? error.code : "unknown";

/** A workspace's plan as pages see it. */
export type PlanState = {
  planId: string;
  planName: string;
  perSeat: boolean;
  viewerRole: boolean;
  limits: Limits;
  viewOnly: boolean;
  /** For each limit, the cheapest plan above this one that allows more, and how much (null: as many as needed). */
  next: Record<LimitName, { name: string; max: number | null } | null>;
};

/** What a plan allows a workspace with `seats` bought. */
export function entitlementsOf(plan: CatalogPlan, seats: number): Entitlements {
  return plan.perSeat ? { ...plan.entitlements, editors: { max: seats } } : plan.entitlements;
}

/** A plan's limit for a name: a per-seat plan has as many editors as it buys. */
const maxOf = (plan: CatalogPlan, name: LimitName): number | null =>
  plan.perSeat && name === "editors" ? Infinity : (plan.entitlements as Entitlements)[name].max;

export function createPlans(deps: { db: Database; settings: PlansSettings; billing: Billing; track?: Track }) {
  const { db, settings, billing } = deps;
  const track: Track = deps.track ?? (() => {});
  const catalog = Object.entries(settings.catalog).map(([id, plan]) => ({ id, ...plan }));
  const planNamed = (id: string) => settings.catalog[id] ?? settings.catalog[settings.free]!;

  async function entitlementsFor(orgId: string): Promise<Entitlements> {
    const plan = planNamed(await billing.planOf(orgId));
    return entitlementsOf(plan, plan.perSeat ? await billing.seatsOf(orgId) : 1);
  }

  const enforcement: Enforcement = createEnforcement({ entitlementsFor });

  /** The cheapest plan after `current` that allows more of `name`, or has `feature`. */
  function upgradeFor(currentId: string, better: (plan: CatalogPlan) => boolean) {
    const from = catalog.findIndex((plan) => plan.id === currentId);
    return catalog.slice(from + 1).find((plan) => plan.stripe && better(plan));
  }

  /** The approved sentence for a refusal. */
  async function describeDenial(orgId: string, denial: Denial, knownPlanId?: string): Promise<string> {
    const planId = knownPlanId ?? (await billing.planOf(orgId));
    const plan = planNamed(planId);
    const support = `Email ${settings.supportEmail} for more.`;
    switch (denial.reason) {
      case "viewOnly":
        return `This workspace is over the ${plan.name} plan's limits, so it's view-only. Delete apps or connections, or upgrade.`;
      case "switchedOff": {
        const next = upgradeFor(planId, (candidate) => (candidate.entitlements as Entitlements)[denial.name].on);
        return next
          ? `${SWITCHES[denial.name]} come with the ${next.name} plan. Upgrade to ${next.name} in Billing.`
          : `${SWITCHES[denial.name]} aren't on the ${plan.name} plan. ${support}`;
      }
      case "limit": {
        if (plan.perSeat && denial.name === "editors") {
          return `All ${denial.max} ${denial.max === 1 ? "seat is" : "seats are"} in use. Add a seat in Billing.`;
        }
        const head = `${denial.max} of ${denial.max} ${noun(denial.name, denial.max)} on ${plan.name}.`;
        const next = upgradeFor(planId, (candidate) => {
          const max = maxOf(candidate, denial.name);
          return max === null || max > denial.max;
        });
        if (!next) return `${head} ${support}`;
        const max = maxOf(next, denial.name);
        return max === null || max === Infinity
          ? `${head} Upgrade to ${next.name} for more ${NOUNS[denial.name][1]}.`
          : `${head} Upgrade to ${next.name} for ${max}.`;
      }
    }
  }

  /** What the services call before a gated operation. */
  const gate: Gate = async (executor, orgId, operation, userId) => {
    const verdict = await enforcement.enforce(executor, orgId, operation);
    if (verdict.ok) return null;
    const planId = await billing.planOf(orgId);
    if (userId) track(userId, "plan_limit_hit", { plan_id: planId, limit: limitOf(verdict.denial), operation, surface: SURFACES[operation] }, orgId);
    return { code: "plan_limit", message: await describeDenial(orgId, verdict.denial, planId) };
  };

  /** Stripe Checkout, recorded as started or failed. */
  async function checkout(input: Parameters<Billing["startCheckout"]>[0], fromPlan: string | null, orgId: string | null) {
    const seats = settings.catalog[input.planId]?.perSeat ? Math.max(input.seats, input.minSeats, 1) : 1;
    const props = { to_plan: input.planId, interval: intervalLabel(input.interval) };
    try {
      const started = await billing.startCheckout(input);
      track(input.userId, "checkout_started", { ...props, from_plan: fromPlan, seats, new_workspace: orgId === null }, orgId);
      return started;
    } catch (error) {
      track(input.userId, "checkout_failed", { ...props, error_code: stripeCode(error), new_workspace: orgId === null }, orgId);
      throw error;
    }
  }

  return {
    billing,
    enforcement,
    gate,
    describeDenial,

    /** Each limit and its usage. */
    getLimits(orgId: string): Promise<Limits> {
      return enforcement.getLimits(db, orgId);
    },

    /** What pages need to show the plan's prompts and disable what it doesn't allow. */
    async state(orgId: string): Promise<PlanState> {
      const planId = await billing.planOf(orgId);
      const plan = planNamed(planId);
      const limits = await enforcement.getLimits(db, orgId);
      return {
        planId,
        planName: plan.name,
        perSeat: plan.perSeat,
        viewerRole: (await entitlementsFor(orgId)).viewerRole.on,
        limits,
        viewOnly: isViewOnly(limits),
        next: Object.fromEntries(
          (Object.keys(limits) as LimitName[]).map((name) => {
            const current = limits[name].max;
            const candidate = current === null ? undefined : upgradeFor(planId, (entry) => {
              const max = maxOf(entry, name);
              return max === null || max > current;
            });
            const max = candidate ? maxOf(candidate, name) : null;
            return [name, candidate ? { name: candidate.name, max: max === Infinity ? null : max } : null];
          }),
        ) as PlanState["next"],
      };
    },

    /** Everything the Billing section shows. */
    async overview(orgId: string) {
      const [planId, subscription, limits] = [await billing.planOf(orgId), await billing.subscription(orgId), await enforcement.getLimits(db, orgId)];
      const plan = planNamed(planId);
      return {
        plan: { id: planId, name: plan.name, perSeat: plan.perSeat },
        subscription,
        limits,
        viewOnly: isViewOnly(limits),
        hasAccount: await billing.hasAccount(orgId),
        /** Plans a free workspace can buy, cheapest first. */
        paidPlans: catalog.filter((entry) => entry.stripe).map((entry) => ({ id: entry.id, name: entry.name })),
        supportEmail: settings.supportEmail,
      };
    },

    /** Checkout for a workspace on the free plan. A per-seat plan starts with the editors it already has. */
    async upgrade(orgId: string, input: { planId: string; interval: Interval; userId: string }) {
      if ((await billing.planOf(orgId)) !== settings.free) return { ok: false as const, message: "This workspace already has a plan. Change it in Manage billing." };
      const plan = settings.catalog[input.planId];
      if (!plan?.stripe) return { ok: false as const, message: "That plan isn't available." };
      const limits = await enforcement.getLimits(db, orgId);
      const inUse = limits.editors.used;
      const entitlements = entitlementsOf(plan, inUse);
      const over = (Object.keys(limits) as LimitName[]).find((name) => entitlements[name].max !== null && limits[name].used > entitlements[name].max!);
      if (over) {
        const max = entitlements[over].max!;
        const used = limits[over].used;
        const remove = used - max;
        return {
          ok: false as const,
          message: `${plan.name} allows ${max} ${noun(over, max)}. You have ${used}, so the workspace would stay view-only. Choose a plan that fits, or remove ${remove} ${noun(over, remove)} first.`,
        };
      }
      const { url } = await checkout({
        orgId,
        planId: input.planId,
        interval: input.interval,
        seats: inUse,
        minSeats: inUse,
        userId: input.userId,
        cancelPath: `/w/${orgId}/settings#billing`,
      }, settings.free, orgId);
      return { ok: true as const, url };
    },

    /** Stripe's page to confirm a new seat count. Never below the seats in use. */
    async changeSeats(orgId: string, seats: number) {
      const inUse = (await enforcement.getLimits(db, orgId)).editors.used;
      if (!Number.isInteger(seats) || seats < 1 || seats > 999) return { ok: false as const, message: "Enter a number of seats from 1 to 999." };
      if (seats < inUse) {
        return {
          ok: false as const,
          message: `${inUse} ${inUse === 1 ? "seat is" : "seats are"} in use. To go lower, first remove an editor, make them a viewer, or revoke an invite.`,
        };
      }
      const { url } = await billing.changeSeats(orgId, seats, `/w/${orgId}/settings#billing`);
      return { ok: true as const, url };
    },

    /**
     * Whether this person may create another free workspace: only if they
     * haven't created one that's on the free plan. Workspaces they joined
     * don't count, and nor does one they left.
     */
    async mayCreateFree(userId: string): Promise<boolean> {
      const created = await db.select({ id: orgs.id }).from(orgs).where(and(eq(orgs.createdBy, userId)));
      for (const org of created) if ((await billing.planOf(org.id)) === settings.free) return false;
      return true;
    },

    /** Checkout for a new workspace, created once it's paid for. */
    async checkoutNewWorkspace(input: { userId: string; name: string; planId: string; interval: Interval; cancelPath: string }) {
      const plan = settings.catalog[input.planId];
      if (!plan?.stripe) return { ok: false as const, message: "That plan isn't available." };
      const { url } = await checkout({
        orgId: null,
        planId: input.planId,
        interval: input.interval,
        seats: 1,
        minSeats: 1,
        userId: input.userId,
        pending: { name: input.name },
        cancelPath: input.cancelPath,
      }, null, null);
      return { ok: true as const, url };
    },
  };
}

export type Plans = ReturnType<typeof createPlans>;
