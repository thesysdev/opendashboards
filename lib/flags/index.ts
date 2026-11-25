import "server-only";

import type { PostHog } from "posthog-node";

import { config } from "@/config";
import { posthogClient } from "@/lib/posthog";

import { createPostHogFlags } from "./posthog";
import { createStaticFlags } from "./static";
import type { FlagProvider } from "./types";

export * from "./types";

/**
 * Which provider this deployment uses: PostHog on our production deployment
 * (where it has a PostHog client); anywhere else (local, previews,
 * self-hosted copies) every flag is on.
 */
export function getFlags(client: Pick<PostHog, "evaluateFlags"> | null = posthogClient() ?? null): FlagProvider {
  return client ? createPostHogFlags(client, config().flags) : createStaticFlags();
}
