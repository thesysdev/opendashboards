import { randomBytes } from "node:crypto";

import { DecryptCommand, EncryptCommand, GenerateDataKeyCommand } from "@aws-sdk/client-kms";
import { describe, expect, it } from "vitest";

import {
  getSecretBox,
  getSecretMode,
  SecretProviderMismatchError,
  SecretStorageNotConfiguredError,
  SecretStorageUnavailableError,
  SecretUnreadableError,
  type SecretContext,
} from "@/lib/secrets";
import { createKmsSecretBox, KMS_ENCRYPT_LIMIT, type KmsClient } from "@/lib/secrets/kms";
import { plaintextSecretBox } from "@/lib/secrets/plaintext";

const context: SecretContext = { purpose: "posthog-api-key", userId: "u1", connectionId: "c1" };

describe("getSecretBox", () => {
  it("uses KMS when a KMS key is configured, in any environment", () => {
    expect(getSecretBox({ environment: "prod", kmsKeyId: "key", kmsRoleArn: "role", allowPlaintext: false }).provider).toBe("kms");
    expect(getSecretBox({ environment: "local", kmsKeyId: "key", kmsRoleArn: "role", allowPlaintext: true }).provider).toBe("kms");
  });

  it("uses plaintext locally where the settings allow it", () => {
    expect(getSecretBox({ environment: "local", kmsKeyId: undefined, allowPlaintext: true }).provider).toBe("plaintext");
  });

  it("refuses prod without KMS, even if its settings allowed plaintext", () => {
    for (const allowPlaintext of [false, true]) {
      expect(() => getSecretBox({ environment: "prod", kmsKeyId: undefined, allowPlaintext })).toThrow(
        SecretStorageNotConfiguredError,
      );
      expect(getSecretMode({ environment: "prod", kmsKeyId: undefined, allowPlaintext })).toBe("unconfigured");
    }
  });
});

describe("plaintext provider", () => {
  it("round-trips a key", async () => {
    const sealed = await plaintextSecretBox.seal("phx_secret", context);
    expect(sealed).toEqual({ v: 1, provider: "plaintext", value: "phx_secret" });
    await expect(plaintextSecretBox.open(sealed, context)).resolves.toBe("phx_secret");
  });

  it("refuses to open another provider's secret", async () => {
    await expect(
      plaintextSecretBox.open({ v: 1, provider: "kms", keyId: "k", ciphertext: "x" }, context),
    ).rejects.toBeInstanceOf(SecretProviderMismatchError);
  });
});

describe("KMS provider", () => {
  const KEY = "arn:aws:kms:us-east-1:1:key/abc";

  /**
   * Stands in for KMS: ciphertext opens only with the context it was sealed
   * with. `ignoreContext` makes Decrypt skip that check, to test the second
   * binding a data-key secret has. Data keys it hands out are kept to check
   * they're wiped.
   */
  function fakeKms({ ignoreContext = false } = {}) {
    const calls: { name: string; input: Record<string, unknown> }[] = [];
    const dataKeys: Uint8Array[] = [];
    const wrap = (bytes: Uint8Array, context: unknown) =>
      new TextEncoder().encode(JSON.stringify({ bytes: Buffer.from(bytes).toString("base64"), context }));
    const client: KmsClient = {
      send: (async (command: EncryptCommand | DecryptCommand | GenerateDataKeyCommand) => {
        calls.push({ name: command.constructor.name, input: command.input as Record<string, unknown> });
        if (command instanceof EncryptCommand) {
          return { CiphertextBlob: wrap(command.input.Plaintext!, command.input.EncryptionContext) };
        }
        if (command instanceof GenerateDataKeyCommand) {
          const key = new Uint8Array(randomBytes(32));
          dataKeys.push(key);
          return { Plaintext: key, CiphertextBlob: wrap(new Uint8Array(key), command.input.EncryptionContext) };
        }
        const { bytes, context: sealedWith } = JSON.parse(new TextDecoder().decode(command.input.CiphertextBlob));
        if (!ignoreContext && JSON.stringify(sealedWith) !== JSON.stringify(command.input.EncryptionContext)) {
          throw Object.assign(new Error("bad context"), { name: "InvalidCiphertextException" });
        }
        return { Plaintext: new Uint8Array(Buffer.from(bytes, "base64")) };
      }) as unknown as KmsClient["send"],
    };
    return { client, calls, dataKeys };
  }

  /** An OAuth sign-in's stored JSON, larger than KMS's Encrypt takes. */
  const bigCredential = JSON.stringify({ kind: "oauth", tokens: { access_token: "eyJ" + "a".repeat(5_000), refresh_token: "r".repeat(800) } });

  describe("a secret over 4,096 bytes", () => {
    it("is sealed with a data key bound to the user and connection, and opens", async () => {
      const { client, calls, dataKeys } = fakeKms();
      const kms = createKmsSecretBox(KEY, { client, roleArn: "role" });
      const sealed = await kms.seal(bigCredential, context);
      expect(sealed).toMatchObject({ v: 2, provider: "kms", keyId: KEY });
      expect(JSON.stringify(sealed)).not.toContain("aaaaaaaaaa");
      expect(calls[0]).toMatchObject({
        name: "GenerateDataKeyCommand",
        input: { KeyId: KEY, KeySpec: "AES_256", EncryptionContext: { purpose: "posthog-api-key", userId: "u1", connectionId: "c1" } },
      });
      // The plaintext data key isn't kept around once used.
      expect(dataKeys[0].every((byte) => byte === 0)).toBe(true);
      await expect(kms.open(sealed, context)).resolves.toBe(bigCredential);
      expect(calls.map((call) => call.name)).toEqual(["GenerateDataKeyCommand", "DecryptCommand"]);
    });

    it("keeps KMS's Encrypt up to 4,096 bytes, and uses a data key just past it", async () => {
      const { client } = fakeKms();
      const kms = createKmsSecretBox(KEY, { client, roleArn: "role" });
      await expect(kms.seal("k".repeat(KMS_ENCRYPT_LIMIT), context)).resolves.toMatchObject({ v: 1 });
      await expect(kms.seal("k".repeat(KMS_ENCRYPT_LIMIT + 1), context)).resolves.toMatchObject({ v: 2 });
    });

    it("won't open when copied to another connection", async () => {
      const { client } = fakeKms();
      const kms = createKmsSecretBox(KEY, { client, roleArn: "role" });
      const sealed = await kms.seal(bigCredential, context);
      await expect(kms.open(sealed, { ...context, connectionId: "c2" })).rejects.toBeInstanceOf(SecretUnreadableError);
    });

    it("is bound to its context by AES-GCM too, not only by KMS", async () => {
      const { client } = fakeKms({ ignoreContext: true });
      const kms = createKmsSecretBox(KEY, { client, roleArn: "role" });
      const sealed = await kms.seal(bigCredential, context);
      await expect(kms.open(sealed, { ...context, userId: "u2" })).rejects.toBeInstanceOf(SecretUnreadableError);
    });

    it("won't open once tampered with", async () => {
      const { client } = fakeKms();
      const kms = createKmsSecretBox(KEY, { client, roleArn: "role" });
      const sealed = await kms.seal(bigCredential, context);
      if (sealed.provider !== "kms" || sealed.v !== 2) throw new Error("expected a data-key secret");
      const box = Buffer.from(sealed.ciphertext, "base64");
      box[10] ^= 1;
      await expect(kms.open({ ...sealed, ciphertext: box.toString("base64") }, context)).rejects.toBeInstanceOf(
        SecretUnreadableError,
      );
      await expect(kms.open({ ...sealed, iv: "AAAA" }, context)).rejects.toBeInstanceOf(SecretUnreadableError);
    });

    it("reports KMS refusing a data key as temporary", async () => {
      const denied = Object.assign(new Error("denied"), { name: "AccessDeniedException" });
      const client: KmsClient = { send: (async () => { throw denied; }) as unknown as KmsClient["send"] };
      const kms = createKmsSecretBox(KEY, { client, roleArn: "role" });
      await expect(kms.seal(bigCredential, context)).rejects.toBeInstanceOf(SecretStorageUnavailableError);
    });
  });

  it("round-trips a key, binding it to the user and connection", async () => {
    const { client, calls } = fakeKms();
    const kms = createKmsSecretBox(KEY, { client, roleArn: "role" });
    const sealed = await kms.seal("phx_secret", context);
    expect(sealed).toMatchObject({ v: 1, provider: "kms", keyId: KEY });
    expect(JSON.stringify(sealed)).not.toContain("phx_secret\"");
    await expect(kms.open(sealed, context)).resolves.toBe("phx_secret");
    expect(calls.map((call) => call.name)).toEqual(["EncryptCommand", "DecryptCommand"]);
    expect(calls[0].input.EncryptionContext).toEqual({ purpose: "posthog-api-key", userId: "u1", connectionId: "c1" });
  });

  it("opens with the key the secret was sealed with", async () => {
    const { client, calls } = fakeKms();
    const sealed = await createKmsSecretBox("old-key", { client, roleArn: "role" }).seal("phx_secret", context);
    await createKmsSecretBox("new-key", { client, roleArn: "role" }).open(sealed, context);
    expect(calls[1].input.KeyId).toBe("old-key");
  });

  it("won't open a secret copied to another connection", async () => {
    const { client } = fakeKms();
    const kms = createKmsSecretBox(KEY, { client, roleArn: "role" });
    const sealed = await kms.seal("phx_secret", context);
    await expect(kms.open(sealed, { ...context, connectionId: "c2" })).rejects.toBeInstanceOf(SecretUnreadableError);
  });

  it("reports other KMS failures as temporary", async () => {
    const denied = Object.assign(new Error("denied"), { name: "AccessDeniedException" });
    const client: KmsClient = { send: (async () => { throw denied; }) as unknown as KmsClient["send"] };
    const kms = createKmsSecretBox(KEY, { client, roleArn: "role" });
    await expect(kms.seal("phx_secret", context)).rejects.toBeInstanceOf(SecretStorageUnavailableError);
    await expect(kms.open({ v: 1, provider: "kms", keyId: KEY, ciphertext: "eA==" }, context)).rejects.toBeInstanceOf(
      SecretStorageUnavailableError,
    );
  });

  it("refuses plaintext rows before calling KMS", async () => {
    const { client, calls } = fakeKms();
    await expect(
      createKmsSecretBox(KEY, { client, roleArn: "role" }).open({ v: 1, provider: "plaintext", value: "phx_secret" }, context),
    ).rejects.toBeInstanceOf(SecretProviderMismatchError);
    expect(calls).toEqual([]);
  });
});
