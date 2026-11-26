import "server-only";

import { ALL_SOURCES } from ".";
import type { ConnectionType } from "./catalog";

/**
 * The source types this deployment is set up to connect: each source's
 * `available()` (Google Ads and Meta Ads need Composio's key and their auth
 * config). The connection service's `availableSources`.
 */
export function availableSources(): ConnectionType[] {
  return ALL_SOURCES.filter((source) => source.available?.() !== false).map((source) => source.type as ConnectionType);
}
