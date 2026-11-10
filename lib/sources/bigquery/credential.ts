import { z } from "zod";

/**
 * A service account key, as Google's JSON key file. Only the two fields
 * OpenDashboards needs are kept: the account's email and its private key. Everything
 * else is dropped, on purpose:
 *
 * - Other credential types (external_account, authorized_user, impersonated…)
 *   are refused. Some make Google's client libraries read local files or run
 *   programs on the machine that loads them.
 * - token_uri and the other URLs in the file are ignored: tokens are only ever
 *   requested from Google's fixed endpoint, so a doctored key file can't send
 *   a signed assertion anywhere else.
 */

export type ServiceAccountKey = { client_email: string; private_key: string };

const SERVICE_ACCOUNT_EMAIL = /^[a-z0-9-]{1,64}@[a-z0-9.:-]+\.iam\.gserviceaccount\.com$/;
const PRIVATE_KEY = /^-----BEGIN PRIVATE KEY-----\n[A-Za-z0-9+/=\n]+-----END PRIVATE KEY-----\n?$/;

const keyFileSchema = z.object({
  type: z.literal("service_account", { error: "This isn't a service account key. In Google Cloud, create a key for a service account and paste its JSON." }),
  client_email: z.string().regex(SERVICE_ACCOUNT_EMAIL, "The key's client_email isn't a service account address."),
  private_key: z
    .string()
    .transform((key) => key.replace(/\r\n/g, "\n"))
    .pipe(z.string().regex(PRIVATE_KEY, "The key's private_key isn't a PEM private key.")),
  project_id: z.string().optional(),
});

/** What the form submits (the pasted JSON), stored as the compact two-field form. */
export const serviceAccountKeySchema = z
  .string()
  .min(1, "Paste the service account's JSON key.")
  .max(20_000, "That's too long for a service account key.")
  .transform((text, ctx) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      ctx.addIssue({ code: "custom", message: "That isn't valid JSON. Paste the whole key file." });
      return z.NEVER;
    }
    const key = keyFileSchema.safeParse(parsed);
    if (!key.success) {
      ctx.addIssue({ code: "custom", message: key.error.issues[0]?.message ?? "That isn't a service account key." });
      return z.NEVER;
    }
    const compact: ServiceAccountKey = { client_email: key.data.client_email, private_key: key.data.private_key };
    return JSON.stringify(compact);
  });

/** Reads a stored credential back. */
export function readServiceAccountKey(credential: string): ServiceAccountKey {
  const parsed = JSON.parse(credential) as Partial<ServiceAccountKey>;
  if (typeof parsed.client_email !== "string" || typeof parsed.private_key !== "string") {
    throw new Error("Stored BigQuery credential is malformed");
  }
  return { client_email: parsed.client_email, private_key: parsed.private_key };
}

/** The project a pasted key belongs to, to prefill the form. Client-safe. */
export function projectIdOfKey(text: string): string | null {
  try {
    const parsed = JSON.parse(text) as { project_id?: unknown };
    return typeof parsed.project_id === "string" ? parsed.project_id : null;
  } catch {
    return null;
  }
}
