import { z } from "zod";

import { posthogCatalog, posthogConfigSchema } from "./posthog/catalog";
import { postgresCatalog, postgresConfigSchema } from "./postgres/catalog";
import type { SourceCatalog, SourceDescription } from "./types";

/**
 * Every source's client-safe catalog. Adding a source: add it here and in
 * ./index.ts, and to the connection_type enum in lib/db/schema.ts.
 */
export const CATALOGS = [posthogCatalog, postgresCatalog] as const;

export const CONNECTION_TYPES = ["posthog", "postgres"] as const satisfies readonly (typeof CATALOGS)[number]["type"][];
export type ConnectionType = (typeof CONNECTION_TYPES)[number];

/** A stored config: the source's settings, tagged with its type. */
export const connectionConfigSchema = z.discriminatedUnion("type", [
  posthogConfigSchema.extend({ type: z.literal("posthog") }),
  postgresConfigSchema.extend({ type: z.literal("postgres") }),
]);

export type ConnectionConfig = z.infer<typeof connectionConfigSchema>;

export function catalogFor(type: ConnectionType): SourceCatalog {
  const catalog = CATALOGS.find((candidate) => candidate.type === type);
  if (!catalog) throw new Error(`Unknown connection type: ${type}`);
  return catalog as unknown as SourceCatalog;
}

export function describeConnection(config: ConnectionConfig): SourceDescription {
  const { type, ...settings } = config;
  return catalogFor(type).describe(settings);
}
