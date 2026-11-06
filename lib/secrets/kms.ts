import {
  NotImplementedError,
  SecretProviderMismatchError,
  type SealedSecret,
  type SecretBox,
  type SecretContext,
} from "./types";

/**
 * AWS KMS, reached through Vercel OIDC federation. Not built yet: sealing and
 * opening throw. When it is, `seal` calls KMS Encrypt and `open` calls KMS
 * Decrypt, both with `context` as the encryption context.
 */
export function createKmsSecretBox(keyId: string): SecretBox {
  return {
    provider: "kms",

    async seal(_plaintext: string, _context: SecretContext): Promise<SealedSecret> {
      throw new NotImplementedError(`KMS secret storage isn't implemented yet (key ${keyId})`);
    },

    async open(sealed: SealedSecret, _context: SecretContext): Promise<string> {
      // Checked first: a plaintext row must never be used by a KMS deployment.
      if (sealed.provider !== "kms") {
        throw new SecretProviderMismatchError("kms", sealed.provider);
      }
      throw new NotImplementedError(`KMS secret storage isn't implemented yet (key ${keyId})`);
    },
  };
}
