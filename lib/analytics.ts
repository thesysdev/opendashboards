import "server-only";

import { waitUntil } from "@vercel/functions";

import { ORG_GROUP, posthogClient } from "@/lib/posthog";

/**
 * Records a product event for a user. Properties are ids, counts and fixed
 * labels: never prompts, queries, names or credentials. `orgId`: the
 * workspace it happened in, as the workspace group.
 */
export function track(userId: string, event: string, properties: Record<string, unknown> = {}, orgId?: string | null): void {
  const client = posthogClient();
  if (!client) return;
  // Sent before the function is frozen; a failure never reaches the user.
  waitUntil(
    client
      .captureImmediate({
        distinctId: userId,
        event: `opendashboards_${event}`,
        properties: { app: "opendashboards", ...properties },
        ...(orgId ? { groups: { [ORG_GROUP]: orgId } } : {}),
      })
      .catch(() => {}),
  );
}

/**
 * Records when a new workspace began, once, when it's created. Never its
 * name.
 */
export function identifyWorkspace(orgId: string, createdAt: Date = new Date()): void {
  const client = posthogClient();
  if (!client) return;
  client.groupIdentify({ groupType: ORG_GROUP, groupKey: orgId, properties: { created: createdAt.toISOString() } });
  waitUntil(client.flush().catch(() => {}));
}

/**
 * The workspace's plan, on its group, whenever its subscription changes: so
 * PostHog can break funnels and usage down by plan.
 */
export function identifyWorkspacePlan(orgId: string, plan: { plan_id: string; seats: number; subscription_status: string }): void {
  const client = posthog();
  if (!client) return;
  client.groupIdentify({ groupType: ORG_GROUP, groupKey: orgId, properties: plan });
  waitUntil(client.flush().catch(() => {}));
}
