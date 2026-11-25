import "server-only";

import type { PostHog } from "posthog-node";

import { ORG_GROUP } from "@/lib/posthog";

import type { FlagProvider } from "./types";

/**
 * Flags from PostHog, for the user and their workspace as our workspace group
 * (ORG_GROUP), so a flag can be rolled out to people or to whole workspaces.
 */
export function createPostHogFlags(client: Pick<PostHog, "evaluateFlags">): FlagProvider {
  return {
    provider: "posthog",
    async isEnabled(flag, { userId, orgId }) {
      try {
        const flags = await client.evaluateFlags(userId, { groups: { [ORG_GROUP]: orgId }, flagKeys: [flag] });
        return flags.isEnabled(flag);
      } catch {
        return false;
      }
    },
  };
}
