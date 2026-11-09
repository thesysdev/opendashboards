import { config, secrets, type Environment } from "@/config";

import { createKmsSecretBox } from "./kms";
import { plaintextSecretBox } from "./plaintext";
import { SecretStorageNotConfiguredError, type SecretBox, type SecretProvider } from "./types";

export * from "./types";

/** What secret storage needs from the configuration. */
export type SecretSettings = { environment: Environment; kmsKeyId: string | undefined; allowPlaintext: boolean };

const current = (): SecretSettings => {
  const { env, secrets: settings } = config();
  return { environment: env, kmsKeyId: secrets.kmsKeyId(), allowPlaintext: settings.allowPlaintext };
};

/** Plaintext is allowed only where the settings allow it and only locally, whatever a settings file says. */
const plaintextAllowed = (settings: SecretSettings) => settings.allowPlaintext && settings.environment === "local";

/**
 * Which provider this deployment uses: KMS when a KMS key is configured,
 * else plaintext locally where the settings allow it. Anywhere else without
 * KMS throws: secrets are never stored unencrypted there.
 */
export function getSecretBox(settings: SecretSettings = current()): SecretBox {
  if (settings.kmsKeyId) return createKmsSecretBox(settings.kmsKeyId);
  if (!plaintextAllowed(settings)) throw new SecretStorageNotConfiguredError();
  warnPlaintextOnce();
  return plaintextSecretBox;
}

/** For the UI: which provider is in use, without throwing. */
export function getSecretMode(settings: SecretSettings = current()): SecretProvider | "unconfigured" {
  if (settings.kmsKeyId) return "kms";
  return plaintextAllowed(settings) ? "plaintext" : "unconfigured";
}

let warned = false;
function warnPlaintextOnce() {
  if (warned) return;
  warned = true;
  console.warn("[prism] Secrets are stored unencrypted (no KMS_KEY_ID). Local development only.");
}
