import { z } from "zod";

import { HOST_KINDS, POSTHOG_HOSTS } from "@/lib/posthog/hosts";
import { postgresAddress, postgresConfigSchema } from "@/lib/postgres/config";

/**
 * A connection's settings that aren't secret, stored in `data_connections.config`
 * and validated on every read. The credential (API key, password) is stored
 * apart, sealed.
 */

export const CONNECTION_TYPES = ["posthog", "postgres"] as const;
export type ConnectionType = (typeof CONNECTION_TYPES)[number];

export const posthogConfigSchema = z
  .object({
    hostKind: z.enum(HOST_KINDS, { error: "Choose a region." }),
    projectId: z
      .string()
      .trim()
      .regex(/^\d{1,12}$/, "The project ID is a number. Find it in PostHog's project settings."),
  })
  .strict();

export type PostHogConfig = z.infer<typeof posthogConfigSchema>;

export const connectionConfigSchema = z.discriminatedUnion("type", [
  posthogConfigSchema.extend({ type: z.literal("posthog") }),
  postgresConfigSchema.extend({ type: z.literal("postgres") }),
]);

export type ConnectionConfig = z.infer<typeof connectionConfigSchema>;

/** How a connection reads in lists and pickers. */
export type ConnectionDescription = {
  /** "PostHog · US Cloud", "Postgres". */
  source: string;
  /** For tight spaces: "PostHog US", "Postgres". */
  shortSource: string;
  /** "Project 12345", "analyst@db.example.com:5432/app". */
  detail: string;
  /** The two letters on the source tile. */
  tile: string;
};

export function describeConnection(config: ConnectionConfig): ConnectionDescription {
  switch (config.type) {
    case "posthog": {
      const region = POSTHOG_HOSTS[config.hostKind].label;
      return {
        source: `PostHog · ${region}`,
        shortSource: `PostHog ${region.replace(" Cloud", "")}`,
        detail: `Project ${config.projectId}`,
        tile: "PH",
      };
    }
    case "postgres":
      return { source: "Postgres", shortSource: "Postgres", detail: postgresAddress(config), tile: "PG" };
  }
}
