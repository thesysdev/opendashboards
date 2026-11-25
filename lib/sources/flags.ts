import "server-only";

import { isFlagEnabled } from "@/lib/analytics";
import type { Scope } from "@/lib/orgs/access";

import type { ConnectionType } from "./catalog";

/**
 * Sources still rolling out, each behind a PostHog feature flag. Off, a
 * source isn't offered and can't be newly connected; connections already
 * made keep working.
 */
const FLAGGED: { flag: string; types: ConnectionType[] }[] = [{ flag: "opendashboards-ads-sources", types: ["googleads", "metaads"] }];

/** The source types this person can't add in this workspace right now. */
export async function hiddenSources(scope: Scope): Promise<ConnectionType[]> {
  const off = await Promise.all(FLAGGED.map(async ({ flag, types }) => ((await isFlagEnabled(flag, scope.userId, scope.orgId)) ? [] : types)));
  return off.flat();
}
