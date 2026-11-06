import { createKmsSecretBox } from "./kms";
import { plaintextSecretBox } from "./plaintext";
import { SecretStorageNotConfiguredError, type SecretBox, type SecretProvider } from "./types";

export * from "./types";

type Env = Record<string, string | undefined>;

/**
 * Which provider this deployment uses: KMS when `KMS_KEY_ID` is set, else
 * plaintext outside production. Production without KMS throws: secrets are
 * never stored unencrypted there.
 */
export function getSecretBox(env: Env = process.env): SecretBox {
  if (env.KMS_KEY_ID) return createKmsSecretBox(env.KMS_KEY_ID);
  if (env.NODE_ENV === "production") throw new SecretStorageNotConfiguredError();
  warnPlaintextOnce();
  return plaintextSecretBox;
}

/** For the UI: which provider is in use, without throwing. */
export function getSecretMode(env: Env = process.env): SecretProvider | "unconfigured" {
  if (env.KMS_KEY_ID) return "kms";
  return env.NODE_ENV === "production" ? "unconfigured" : "plaintext";
}

let warned = false;
function warnPlaintextOnce() {
  if (warned) return;
  warned = true;
  console.warn("[prism] Secrets are stored unencrypted (no KMS_KEY_ID). Local development only.");
}
