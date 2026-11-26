import { z } from "zod";

/** The sources that sign in through Composio, by their Composio toolkit slug (also their connection type). Client-safe. */
export const COMPOSIO_TOOLKITS = ["googleads", "metaads"] as const;
export type ComposioToolkit = (typeof COMPOSIO_TOOLKITS)[number];

/**
 * The settings of a source that signs in through Composio (Google Ads, Meta
 * Ads). Client-safe. There's nothing to choose: which ad accounts a query
 * reads is an argument of the query, and the sign-in decides which ones it
 * may. The `oauth` marker, filled in when absent, is what makes it a sign-in
 * connection: its credential is per person, in connection_sign_ins.
 */
export const composioSignInConfigSchema = z
  .object({ oauth: z.object({ provider: z.literal("composio") }).strict().default({ provider: "composio" }) })
  .strict();

export type ComposioSignInConfig = z.infer<typeof composioSignInConfigSchema>;
