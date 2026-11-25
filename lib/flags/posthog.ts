import "server-only";

import type { PostHog } from "posthog-node";

import { ORG_GROUP } from "@/lib/posthog";

import type { FlagProvider } from "./types";

/**
 * Flags from PostHog, for the user and their workspace as our workspace group
 * (ORG_GROUP), so a flag can be rolled out to people or to whole workspaces.
 * A flag PostHog doesn't answer for within `timeoutMs` is off.
 */
export function createPostHogFlags(client: Pick<PostHog, "evaluateFlags">, { timeoutMs }: { timeoutMs: number }): FlagProvider {
  return {
    provider: "posthog",
    async isEnabled(flag, { userId, orgId }) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const late = new Promise<false>((resolve) => {
        timer = setTimeout(() => resolve(false), timeoutMs);
      });
      try {
        const answer = client.evaluateFlags(userId, { groups: { [ORG_GROUP]: orgId }, flagKeys: [flag] }).then((flags) => flags.isEnabled(flag));
        return await Promise.race([answer, late]);
      } catch {
        return false;
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
