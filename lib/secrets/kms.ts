import { DecryptCommand, EncryptCommand, KMSClient } from "@aws-sdk/client-kms";
import { awsCredentialsProvider } from "@vercel/oidc-aws-credentials-provider";

import { config } from "@/config";
import { count } from "@/lib/metrics";

import {
  SecretProviderMismatchError,
  SecretStorageUnavailableError,
  SecretUnreadableError,
  type SealedSecret,
  type SecretBox,
  type SecretContext,
} from "./types";

/** The part of the KMS client this provider uses, so tests can stand in for AWS. */
export type KmsClient = Pick<KMSClient, "send">;

export type KmsOptions = {
  /** The role to assume through Vercel OIDC. */
  roleArn: string;
  /** Replaces the real client in tests. */
  client?: KmsClient;
};

function createClient(roleArn: string): KMSClient {
  return new KMSClient({ region: config().kms.region, credentials: awsCredentialsProvider({ roleArn }) });
}

function countFailure(operation: "encrypt" | "decrypt", cause: unknown) {
  count("prism.kms.failure", { operation, error: cause instanceof Error ? cause.name : "unknown" });
}

/** KMS treats the encryption context as authenticated data: it must match to decrypt. */
const encryptionContext = ({ purpose, userId, connectionId }: SecretContext) => ({ purpose, userId, connectionId });

/**
 * AWS KMS, reached through Vercel OIDC federation. `context` is the encryption
 * context, so a sealed secret only opens for the same user and connection.
 * Credentials are far below KMS's 4 KB limit, so they're encrypted directly.
 */
export function createKmsSecretBox(keyId: string, options: KmsOptions): SecretBox {
  let client = options.client;
  const kms = () => (client ??= createClient(options.roleArn));

  return {
    provider: "kms",

    async seal(plaintext: string, context: SecretContext): Promise<SealedSecret> {
      let blob: Uint8Array | undefined;
      try {
        ({ CiphertextBlob: blob } = await kms().send(
          new EncryptCommand({
            KeyId: keyId,
            Plaintext: new TextEncoder().encode(plaintext),
            EncryptionContext: encryptionContext(context),
          }),
        ));
      } catch (cause) {
        countFailure("encrypt", cause);
        throw new SecretStorageUnavailableError("KMS couldn't encrypt the secret", { cause });
      }
      if (!blob) throw new SecretStorageUnavailableError("KMS returned no ciphertext");
      return { v: 1, provider: "kms", keyId, ciphertext: Buffer.from(blob).toString("base64") };
    },

    async open(sealed: SealedSecret, context: SecretContext): Promise<string> {
      // Checked first: a plaintext row must never be used by a KMS deployment.
      if (sealed.provider !== "kms") {
        throw new SecretProviderMismatchError("kms", sealed.provider);
      }
      let plaintext: Uint8Array | undefined;
      try {
        ({ Plaintext: plaintext } = await kms().send(
          new DecryptCommand({
            // The key it was sealed with, so secrets outlive a change of KMS_KEY_ID.
            KeyId: sealed.keyId,
            CiphertextBlob: Buffer.from(sealed.ciphertext, "base64"),
            EncryptionContext: encryptionContext(context),
          }),
        ));
      } catch (cause) {
        countFailure("decrypt", cause);
        // A wrong context or a damaged value. Anything else may pass on a retry.
        if (cause instanceof Error && cause.name === "InvalidCiphertextException") {
          throw new SecretUnreadableError({ cause });
        }
        throw new SecretStorageUnavailableError("KMS couldn't decrypt the secret", { cause });
      }
      if (!plaintext) throw new SecretStorageUnavailableError("KMS returned no plaintext");
      return new TextDecoder().decode(plaintext);
    },
  };
}
