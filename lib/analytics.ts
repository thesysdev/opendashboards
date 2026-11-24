import "server-only";

import { waitUntil } from "@vercel/functions";
import { PostHog } from "posthog-node";

// Thesys' PostHog project, shared with openui.com and the Thesys console, through
// its proxy. The key is set only on our production deployment, so copies of
// OpenDashboards send nothing (instrumentation-client.ts reads it too).
const POSTHOG_KEY = process.env.NEXT_PUBLIC_POSTHOG_KEY;
const POSTHOG_HOST = "https://dgoeivjus9jfp.cloudfront.net";

/**
 * Our own PostHog group type for workspaces. Not "org": that one is the
 * console's and the API's (coda) organizations, in the same project.
 */
const WORKSPACE_GROUP = "opendash_workspace";

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
        properties: { app: "opendashboards", environment: "production", ...properties },
        ...(orgId ? { groups: { [WORKSPACE_GROUP]: orgId } } : {}),
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
  client.groupIdentify({ groupType: WORKSPACE_GROUP, groupKey: orgId, properties: { created: createdAt.toISOString() } });
  waitUntil(client.flush().catch(() => {}));
}
