import "server-only";

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
export const ORG_GROUP = "opendash_org";

let client: PostHog | undefined;

/** The server's PostHog client, on our production deployment only: shared by analytics (lib/analytics) and feature flags (lib/flags). */
export function posthogClient(): PostHog | undefined {
  if (!POSTHOG_KEY || process.env.VERCEL_ENV !== "production") return undefined;
  return (client ??= new PostHog(POSTHOG_KEY, { host: POSTHOG_HOST }));
}
