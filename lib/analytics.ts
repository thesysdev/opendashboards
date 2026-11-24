import "server-only";

import { waitUntil } from "@vercel/functions";
import { PostHog } from "posthog-node";

// The same PostHog project and proxy as openui.com.
const POSTHOG_KEY = "phc_3OLW53x09ZTVZSV6BEpj5uycj3ooqR6KOemOjx04e3D";
const POSTHOG_HOST = "https://dgoeivjus9jfp.cloudfront.net";

let client: PostHog | undefined;

/**
 * Records a product event for a user, only on Vercel. Properties are ids,
 * counts and fixed labels: never prompts, queries, names or credentials.
 * `orgId`: the workspace it happened in, as PostHog's "org" group: the group
 * type the console and API (coda) already use in this project. A workspace's
 * group says `product: "opendashboards"` (identifyWorkspace), so ours can be
 * told apart from console orgs.
 */
export function track(userId: string, event: string, properties: Record<string, unknown> = {}, orgId?: string | null): void {
  const environment = process.env.VERCEL_ENV;
  if (!environment) return;
  client ??= new PostHog(POSTHOG_KEY, { host: POSTHOG_HOST });
  // Sent before the function is frozen; a failure never reaches the user.
  waitUntil(
    client
      .captureImmediate({
        distinctId: userId,
        event: `opendashboards_${event}`,
        properties: { app: "opendashboards", environment, ...properties },
        ...(orgId ? { groups: { org: orgId } } : {}),
      })
      .catch(() => {}),
  );
}

/**
 * Marks a new workspace's "org" group as OpenDashboards', once, when it's
 * created. Never its name: only that it's ours and when it began.
 */
export function identifyWorkspace(orgId: string, createdAt: Date = new Date()): void {
  const environment = process.env.VERCEL_ENV;
  if (!environment) return;
  client ??= new PostHog(POSTHOG_KEY, { host: POSTHOG_HOST });
  client.groupIdentify({ groupType: "org", groupKey: orgId, properties: { product: "opendashboards", created: createdAt.toISOString() } });
  waitUntil(client.flush().catch(() => {}));
}
