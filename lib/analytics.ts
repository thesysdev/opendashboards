import "server-only";

import { waitUntil } from "@vercel/functions";
import { PostHog } from "posthog-node";

// Thesys' PostHog project, shared with openui.com and the Thesys console, through
// its proxy. The key is set only on our production deployment, so copies of
// OpenDashboards send nothing (instrumentation-client.ts reads it too).
const POSTHOG_KEY = process.env.NEXT_PUBLIC_POSTHOG_KEY;
const POSTHOG_HOST = "https://dgoeivjus9jfp.cloudfront.net";

/**
 * Our own PostHog group type for orgs (workspaces in the UI). Not "org": that
 * one is the console's and the API's (coda) organizations, in the same project.
 */
const ORG_GROUP = "opendash_org";

let client: PostHog | undefined;

/** The PostHog client, on our production deployment only. */
function posthog(): PostHog | undefined {
  if (!POSTHOG_KEY || process.env.VERCEL_ENV !== "production") return undefined;
  return (client ??= new PostHog(POSTHOG_KEY, { host: POSTHOG_HOST }));
}

/**
 * Records a product event for a user. Properties are ids, counts and fixed
 * labels: never prompts, queries, names or credentials. `orgId`: the
 * workspace it happened in, as the workspace group.
 */
export function track(userId: string, event: string, properties: Record<string, unknown> = {}, orgId?: string | null): void {
  const client = posthog();
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
  const client = posthog();
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
