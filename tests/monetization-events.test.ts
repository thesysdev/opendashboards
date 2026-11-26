import { beforeEach, describe, expect, it, vi } from "vitest";

const analytics = vi.hoisted(() => ({ track: vi.fn(), identifyWorkspacePlan: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/analytics", () => analytics);

import type { SubscriptionChange } from "@/lib/billing";
import { viewerRole } from "@/lib/orgs/policy";
import { trackSubscription } from "@/lib/plans";

const ORG = "11111111-1111-4111-8111-111111111111";
const change = (over: Partial<SubscriptionChange> = {}): SubscriptionChange => ({
  kind: "started",
  orgId: ORG,
  userId: "bob",
  plan: "team",
  previousPlan: "free",
  interval: "year",
  seats: 3,
  previousSeats: 1,
  status: "active",
  cancelAtPeriodEnd: false,
  ...over,
});

beforeEach(() => vi.clearAllMocks());

describe("subscription events", () => {
  it("records the event and the workspace group's plan", () => {
    trackSubscription(change());
    expect(analytics.track).toHaveBeenCalledTimes(1);
    expect(analytics.track).toHaveBeenCalledWith(
      "bob",
      "subscription_started",
      { plan_id: "team", previous_plan_id: "free", interval: "annual", seats: 3, status: "active", cancel_at_period_end: false },
      ORG,
    );
    expect(analytics.identifyWorkspacePlan).toHaveBeenCalledWith(ORG, { plan_id: "team", seats: 3, subscription_status: "active" });
  });

  it("adds seats_changed when the seat count moved", () => {
    trackSubscription(change({ kind: "changed", previousPlan: "team", seats: 5, previousSeats: 3 }));
    expect(analytics.track.mock.calls.map(([, event]) => event)).toEqual(["subscription_changed", "seats_changed"]);
    expect(analytics.track).toHaveBeenLastCalledWith("bob", "seats_changed", { from_seats: 3, to_seats: 5, plan_id: "team" }, ORG);
  });

  it("keeps only the group's plan when nobody can be credited", () => {
    trackSubscription(change({ kind: "cancelled", userId: null, plan: "free", status: "canceled" }));
    expect(analytics.track).not.toHaveBeenCalled();
    expect(analytics.identifyWorkspacePlan).toHaveBeenCalledWith(ORG, { plan_id: "free", seats: 3, subscription_status: "canceled" });
  });
});

describe("viewer_role", () => {
  it.each([
    [{ access: "owner", guest: false }, "owner"],
    [{ access: "edit", guest: false }, "editor"],
    [{ access: "view", guest: false }, "viewer"],
    [{ access: "view", guest: true }, "guest"],
  ] as const)("%o is %s", (facts, role) => {
    expect(viewerRole(facts)).toBe(role);
  });
});
