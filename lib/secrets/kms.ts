import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

import { DecryptCommand, EncryptCommand, GenerateDataKeyCommand, KMSClient } from "@aws-sdk/client-kms";
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
  assertSecretSize,
  secretBytes,
} from "./types";

/** The part of the KMS client this provider uses, so tests can stand in for AWS. */
export type KmsClient = Pick<KMSClient, "send">;

export type KmsOptions = {
  /** The role to assume through Vercel OIDC. */
  roleArn: string;
  /** Replaces the real client in tests. */
  client?: KmsClient;
};

/** The most KMS's Encrypt takes with a symmetric key. Anything larger is sealed with a data key. */
export const KMS_ENCRYPT_LIMIT = 4_096;

const IV_BYTES = 12;
const TAG_BYTES = 16;

function createClient(roleArn: string): KMSClient {
  return new KMSClient({ region: config().kms.region, credentials: awsCredentialsProvider({ roleArn }) });
}

function countFailure(operation: "encrypt" | "decrypt", cause: unknown) {
  count("opendashboards.kms.failure", { operation, error: cause instanceof Error ? cause.name : "unknown" });
}

/** KMS treats the encryption context as authenticated data: it must match to decrypt. */
const encryptionContext = ({ purpose, userId, connectionId }: SecretContext) => ({ purpose, userId, connectionId });

/** The same binding for a secret sealed here with a data key: AES-GCM's additional data. */
const additionalData = (context: SecretContext) => Buffer.from(JSON.stringify(encryptionContext(context)), "utf8");

const base64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64");

/**
 * AWS KMS, reached through Vercel OIDC federation. `context` is the encryption
 * context, so a sealed secret only opens for the same user and connection.
 *
 * Up to 4,096 bytes, KMS encrypts the secret itself (v1). Larger secrets, such
 * as an OAuth sign-in's tokens, are envelope-encrypted (v2): KMS issues a data
 * key bound to the same context, the secret is encrypted with it here using
 * AES-256-GCM with the context as additional data, and only the KMS-encrypted
 * data key is stored. The plaintext data key is wiped once used.
 */
export function createKmsSecretBox(keyId: string, options: KmsOptions): SecretBox {
  let client = options.client;
  const kms = () => (client ??= createClient(options.roleArn));

  /** KMS decrypts a blob it encrypted, under the key and context it was sealed with. */
  async function decrypt(sealedWith: string, blob: string, context: SecretContext): Promise<Uint8Array> {
    let plaintext: Uint8Array | undefined;
    try {
      ({ Plaintext: plaintext } = await kms().send(
        new DecryptCommand({
          // The key it was sealed with, so secrets outlive a change of KMS_KEY_ID.
          KeyId: sealedWith,
          CiphertextBlob: Buffer.from(blob, "base64"),
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
    return plaintext;
  }

  async function sealDirect(plaintext: string, context: SecretContext): Promise<SealedSecret> {
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
    return { v: 1, provider: "kms", keyId, ciphertext: base64(blob) };
  }

  async function sealWithDataKey(plaintext: string, context: SecretContext): Promise<SealedSecret> {
    let dataKey: Uint8Array | undefined;
    let encryptedKey: Uint8Array | undefined;
    try {
      ({ Plaintext: dataKey, CiphertextBlob: encryptedKey } = await kms().send(
        new GenerateDataKeyCommand({ KeyId: keyId, KeySpec: "AES_256", EncryptionContext: encryptionContext(context) }),
      ));
    } catch (cause) {
      countFailure("encrypt", cause);
      throw new SecretStorageUnavailableError("KMS couldn't issue a data key", { cause });
    }
    if (!dataKey || !encryptedKey) throw new SecretStorageUnavailableError("KMS returned no data key");
    try {
      const iv = randomBytes(IV_BYTES);
      const cipher = createCipheriv("aes-256-gcm", dataKey, iv, { authTagLength: TAG_BYTES });
      cipher.setAAD(additionalData(context));
      const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final(), cipher.getAuthTag()]);
      return { v: 2, provider: "kms", keyId, dataKey: base64(encryptedKey), iv: base64(iv), ciphertext: base64(ciphertext) };
    } finally {
      dataKey.fill(0);
    }
  }

  return {
    provider: "kms",

    async seal(plaintext: string, context: SecretContext): Promise<SealedSecret> {
      assertSecretSize(plaintext);
      return secretBytes(plaintext) <= KMS_ENCRYPT_LIMIT
        ? sealDirect(plaintext, context)
        : sealWithDataKey(plaintext, context);
    },

    async open(sealed: SealedSecret, context: SecretContext): Promise<string> {
      // Checked first: a plaintext row must never be used by a KMS deployment.
      if (sealed.provider !== "kms") {
        throw new SecretProviderMismatchError("kms", sealed.provider);
      }
      if (sealed.v === 1) return new TextDecoder().decode(await decrypt(sealed.keyId, sealed.ciphertext, context));

      // The data key only opens under the same context, and AES-GCM checks it again.
      const dataKey = await decrypt(sealed.keyId, sealed.dataKey, context);
      try {
        const iv = Buffer.from(sealed.iv, "base64");
        const box = Buffer.from(sealed.ciphertext, "base64");
        if (iv.length !== IV_BYTES || box.length < TAG_BYTES) throw new Error("Malformed sealed secret");
        const decipher = createDecipheriv("aes-256-gcm", dataKey, iv, { authTagLength: TAG_BYTES });
        decipher.setAAD(additionalData(context));
        decipher.setAuthTag(box.subarray(box.length - TAG_BYTES));
        return Buffer.concat([decipher.update(box.subarray(0, box.length - TAG_BYTES)), decipher.final()]).toString("utf8");
      } catch (cause) {
        // A damaged value, or one moved to another connection with its data key.
        throw new SecretUnreadableError({ cause });
      } finally {
        dataKey.fill(0);
      }
    },
  };
}
