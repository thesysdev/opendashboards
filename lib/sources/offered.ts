import "server-only";

import type { FlagProvider } from "@/lib/flags";
import type { Scope } from "@/lib/orgs/access";

import { ALL_SOURCES } from ".";
import type { ConnectionType } from "./catalog";
import { hiddenSources } from "./flags";

/**
 * The source types this person can't add in this workspace: ones this
 * deployment isn't set up for (no Composio key, say), and ones still rolling
 * out behind a feature flag that's off for them. The connection service's
 * `notOffered`.
 */
export async function notOfferedSources(scope: Scope, flags?: FlagProvider): Promise<ConnectionType[]> {
  const unavailable = ALL_SOURCES.filter((source) => source.available?.() === false).map((source) => source.type as ConnectionType);
  return [...new Set([...unavailable, ...(await hiddenSources(scope, flags))])];
}
