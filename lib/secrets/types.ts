/**
 * What a secret is bound to. The KMS provider passes it as the encryption
 * context, so a sealed secret only opens for the same user and connection:
 * copying it into another row gets a decrypt error, not a working key.
 */
export type SecretContext = {
  /** What the secret is for, from its source: "posthog-api-key", "postgres-password". */
  purpose: string;
  userId: string;
  connectionId: string;
};

/**
 * A secret as stored. `provider` and `v` say how to open it. "none" records
 * that there is no secret: a server that needs no password. It holds nothing,
 * so there is nothing to encrypt.
 *
 * KMS v1 is encrypted by KMS itself, which takes at most 4,096 bytes. KMS v2
 * is for larger secrets, such as an OAuth sign-in's tokens: KMS issues a data
 * key bound to the same context, the secret is encrypted with it here
 * (AES-256-GCM), and only the KMS-encrypted data key is stored with it.
 */
export type SealedSecret =
  | { v: 1; provider: "plaintext"; value: string }
  | { v: 1; provider: "kms"; keyId: string; ciphertext: string }
  | { v: 2; provider: "kms"; keyId: string; dataKey: string; iv: string; ciphertext: string }
  | { v: 1; provider: "none" };

export type SecretProvider = Exclude<SealedSecret["provider"], "none">;

export interface SecretBox {
  readonly provider: SecretProvider;
  seal(plaintext: string, context: SecretContext): Promise<SealedSecret>;
  open(sealed: SealedSecret, context: SecretContext): Promise<string>;
}

/**
 * The largest secret we store, in bytes of UTF-8: room for any real
 * credential, OAuth sign-ins with large tokens included, while still refusing
 * a pasted file. Every provider applies the same limit so local development
 * fails exactly where production would.
 */
export const MAX_SECRET_BYTES = 65_536;

/** Bytes a secret takes: KMS counts bytes, not characters. */
export const secretBytes = (plaintext: string) => Buffer.byteLength(plaintext, "utf8");

/** A secret over MAX_SECRET_BYTES. Carries only its size, never the value. */
export class SecretTooLargeError extends Error {
  constructor(
    readonly bytes: number,
    readonly limit: number = MAX_SECRET_BYTES,
  ) {
    super(`The secret is ${bytes} bytes; the most that can be stored is ${limit}`);
    this.name = "SecretTooLargeError";
  }
}

/** Refuses a secret over the limit, before any provider sees it. */
export function assertSecretSize(plaintext: string): void {
  const bytes = secretBytes(plaintext);
  if (bytes > MAX_SECRET_BYTES) throw new SecretTooLargeError(bytes);
}

/** The secret store couldn't be reached or refused the call. A retry may work. */
export class SecretStorageUnavailableError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "SecretStorageUnavailableError";
  }
}

/** The stored value can't be opened for this user and connection: the user has to enter it again. */
export class SecretUnreadableError extends Error {
  constructor(options?: ErrorOptions) {
    super("The stored secret can't be decrypted for this connection", options);
    this.name = "SecretUnreadableError";
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
