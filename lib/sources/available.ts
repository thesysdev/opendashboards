import "server-only";

import { FLAGS, getFlags, type FlagProvider } from "@/lib/flags";
import type { Scope } from "@/lib/orgs/access";

import { ALL_SOURCES } from ".";
import type { ConnectionType } from "./catalog";

/** Sources still rolling out, behind FLAGS.adsSources. */
const ADS: readonly string[] = ["googleads", "metaads"];

/**
 * The source types this person can add in this workspace: the ones this
 * deployment is set up for (a source's `available()`), less Google Ads and
 * Meta Ads while their feature flag is off for them. The connection
 * service's `availableSources`.
 */
export async function availableSources(scope: Scope, flags: FlagProvider = getFlags()): Promise<ConnectionType[]> {
  const ads = await flags.isEnabled(FLAGS.adsSources, scope);
  return ALL_SOURCES.filter((source) => source.available?.() !== false && (ads || !ADS.includes(source.type))).map((source) => source.type as ConnectionType);
}
