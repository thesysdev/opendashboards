/**
 * What a secret is bound to. The KMS provider passes it as the encryption
 * context, so a sealed secret only opens for the same user and connection:
 * copying it into another row gets a decrypt error, not a working key.
 */
export type SecretContext = {
  purpose: "posthog-api-key";
  userId: string;
  connectionId: string;
};

/** A secret as stored. `provider` and `v` say how to open it. */
export type SealedSecret =
  | { v: 1; provider: "plaintext"; value: string }
  | { v: 1; provider: "kms"; keyId: string; ciphertext: string };

export type SecretProvider = SealedSecret["provider"];

export interface SecretBox {
  readonly provider: SecretProvider;
  seal(plaintext: string, context: SecretContext): Promise<SealedSecret>;
  open(sealed: SealedSecret, context: SecretContext): Promise<string>;
}

/** A provider that exists but isn't built yet. */
export class NotImplementedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NotImplementedError";
  }
}

/** Production has no usable secret storage configured. */
export class SecretStorageNotConfiguredError extends Error {
  constructor() {
    super("Secret storage isn't configured: set KMS_KEY_ID");
    this.name = "SecretStorageNotConfiguredError";
  }
}

/**
 * A stored secret was written by a different provider than the one running,
 * e.g. a plaintext row (from a local database) read by a KMS deployment. It's
 * never used: the user has to enter the key again.
 */
export class SecretProviderMismatchError extends Error {
  constructor(
    readonly expected: SecretProvider,
    readonly found: string,
  ) {
    super(`Secret was stored by "${found}", but this deployment uses "${expected}"`);
    this.name = "SecretProviderMismatchError";
  }
}
