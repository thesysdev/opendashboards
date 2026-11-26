import posthog from "posthog-js";

/*
 * Product events from the browser, named like the server's (lib/analytics.ts):
 * `opendashboards_` first, the workspace as the `opendash_org` group. Same
 * rules: ids, counts and fixed labels only. Nothing is sent where PostHog
 * isn't set up (instrumentation-client.ts), which is everywhere but production.
 */

/** Where an upgrade was asked for: plan_limit_hit's `surface` names, plus the places that only sell. */
export type UpgradeSource =
  | "apps"
  | "connections"
  | "members"
  | "sharing"
  | "chat"
  | "limit_banner"
  | "settings"
  | "new_workspace"
  | "pricing";

/** A billing period, as events name it. */
export type IntervalLabel = "monthly" | "annual";

export const intervalLabel = (interval: "month" | "year"): IntervalLabel => (interval === "year" ? "annual" : "monthly");

export function trackClient(event: string, properties: Record<string, unknown>, orgId?: string | null): void {
  if (!posthog.__loaded) return;
  posthog.capture(`opendashboards_${event}`, { ...properties, ...(orgId ? { $groups: { opendash_org: orgId } } : {}) });
}

/** Someone chose a plan: in a workspace's plan picker, or on the pricing page. */
export function trackUpgradeClicked(input: {
  fromPlan: string | null;
  toPlan: string;
  interval: IntervalLabel;
  source: UpgradeSource;
  orgId: string | null;
}): void {
  trackClient("upgrade_clicked", { from_plan: input.fromPlan, to_plan: input.toPlan, interval: input.interval, source: input.source }, input.orgId);
}
