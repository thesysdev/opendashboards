import "server-only";

import type { ConnectionType } from "./catalog";
import { postgresSource } from "./postgres/source";
import { posthogSource } from "./posthog/source";
import type { ConnectionSource } from "./types";

/**
 * Every data source, server side. Generic code finds a source's credential
 * rules, checks, errors and tools here and nowhere else.
 */
const SOURCES: Record<ConnectionType, ConnectionSource> = {
  posthog: posthogSource as unknown as ConnectionSource,
  postgres: postgresSource as unknown as ConnectionSource,
};

export function sourceFor(type: ConnectionType): ConnectionSource {
  return SOURCES[type];
}

export const ALL_SOURCES: readonly ConnectionSource[] = Object.values(SOURCES);
