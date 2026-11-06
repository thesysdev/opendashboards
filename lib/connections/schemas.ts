import { z } from "zod";

import { passwordSchema, postgresConfigSchema } from "@/lib/postgres/config";

import { posthogConfigSchema } from "./config";

export const connectionNameSchema = z
  .string()
  .trim()
  .min(1, "Enter a name.")
  .max(80, "Keep the name under 80 characters.");

export const apiKeySchema = z
  .string()
  .trim()
  .regex(/^phx_[A-Za-z0-9_-]{16,200}$/, "Personal API keys start with phx_.");

export const connectionIdSchema = z.uuid();

/**
 * One shape per source type. `.strict()`: an unexpected field (a URL, a
 * connection string) fails instead of being ignored.
 */
export const createConnectionSchema = z.discriminatedUnion("type", [
  posthogConfigSchema
    .extend({ type: z.literal("posthog"), name: connectionNameSchema, apiKey: apiKeySchema })
    .strict(),
  postgresConfigSchema
    .extend({ type: z.literal("postgres"), name: connectionNameSchema, password: passwordSchema })
    .strict(),
]);

/** A new API key or password. Which one is checked against the saved connection's type. */
export const replaceCredentialSchema = z
  .object({ id: connectionIdSchema, credential: z.string() })
  .strict();

export const renameSchema = z.object({ id: connectionIdSchema, name: connectionNameSchema }).strict();
export const connectionRefSchema = z.object({ id: connectionIdSchema }).strict();

export type CreateConnectionInput = z.infer<typeof createConnectionSchema>;
