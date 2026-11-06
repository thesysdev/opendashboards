import { z } from "zod";

import { hostKindEnum } from "@/lib/db/schema";

export const connectionNameSchema = z
  .string()
  .trim()
  .min(1, "Enter a name.")
  .max(80, "Keep the name under 80 characters.");

export const hostKindSchema = z.enum(hostKindEnum.enumValues, { error: "Choose a region." });

export const projectIdSchema = z
  .string()
  .trim()
  .regex(/^\d{1,12}$/, "The project ID is a number. Find it in PostHog's project settings.");

export const apiKeySchema = z
  .string()
  .trim()
  .regex(/^phx_[A-Za-z0-9_-]{16,200}$/, "Personal API keys start with phx_.");

export const connectionIdSchema = z.uuid();

/** `.strict()`: an unexpected field (a URL, a host) fails instead of being ignored. */
export const createConnectionSchema = z
  .object({
    name: connectionNameSchema,
    hostKind: hostKindSchema,
    projectId: projectIdSchema,
    apiKey: apiKeySchema,
  })
  .strict();

export const replaceKeySchema = z.object({ id: connectionIdSchema, apiKey: apiKeySchema }).strict();
export const renameSchema = z.object({ id: connectionIdSchema, name: connectionNameSchema }).strict();
export const connectionRefSchema = z.object({ id: connectionIdSchema }).strict();

export type CreateConnectionInput = z.infer<typeof createConnectionSchema>;
