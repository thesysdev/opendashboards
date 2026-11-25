import "server-only";

import { FLAGS, getFlags, type Flag, type FlagProvider } from "@/lib/flags";
import type { Scope } from "@/lib/orgs/access";

import type { ConnectionType } from "./catalog";

/**
 * Sources still rolling out, each behind a feature flag. Off, a source isn't
 * offered and can't be newly connected; connections already made keep working.
 */
const FLAGGED: { flag: Flag; types: ConnectionType[] }[] = [{ flag: FLAGS.adsSources, types: ["googleads", "metaads"] }];

/** The source types this person can't add in this workspace right now. */
export async function hiddenSources(scope: Scope, flags: FlagProvider = getFlags()): Promise<ConnectionType[]> {
  const off = await Promise.all(FLAGGED.map(async ({ flag, types }) => ((await flags.isEnabled(flag, scope)) ? [] : types)));
  return off.flat();
}
