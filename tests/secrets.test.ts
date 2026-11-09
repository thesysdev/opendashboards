import { DecryptCommand, EncryptCommand } from "@aws-sdk/client-kms";
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
import { createKmsSecretBox, type KmsClient } from "@/lib/secrets/kms";
import { plaintextSecretBox } from "@/lib/secrets/plaintext";

const context: SecretContext = { purpose: "posthog-api-key", userId: "u1", connectionId: "c1" };

describe("getSecretBox", () => {
  it("uses KMS when a KMS key is configured, in any environment", () => {
    expect(getSecretBox({ environment: "prod", kmsKeyId: "key", allowPlaintext: false }).provider).toBe("kms");
    expect(getSecretBox({ environment: "local", kmsKeyId: "key", allowPlaintext: true }).provider).toBe("kms");
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

  /** Stands in for KMS: ciphertext opens only with the context it was sealed with. */
  function fakeKms() {
    const calls: { name: string; input: Record<string, unknown> }[] = [];
    const client: KmsClient = {
      send: (async (command: EncryptCommand | DecryptCommand) => {
        calls.push({ name: command.constructor.name, input: command.input as Record<string, unknown> });
        if (command instanceof EncryptCommand) {
          const sealed = JSON.stringify({
            text: new TextDecoder().decode(command.input.Plaintext),
            context: command.input.EncryptionContext,
          });
          return { CiphertextBlob: new TextEncoder().encode(sealed) };
        }
        const { text, context: sealedWith } = JSON.parse(new TextDecoder().decode(command.input.CiphertextBlob));
        if (JSON.stringify(sealedWith) !== JSON.stringify(command.input.EncryptionContext)) {
          throw Object.assign(new Error("bad context"), { name: "InvalidCiphertextException" });
        }
        return { Plaintext: new TextEncoder().encode(text) };
      }) as unknown as KmsClient["send"],
    };
    return { client, calls };
  }

  it("round-trips a key, binding it to the user and connection", async () => {
    const { client, calls } = fakeKms();
    const kms = createKmsSecretBox(KEY, { client });
    const sealed = await kms.seal("phx_secret", context);
    expect(sealed).toMatchObject({ v: 1, provider: "kms", keyId: KEY });
    expect(JSON.stringify(sealed)).not.toContain("phx_secret\"");
    await expect(kms.open(sealed, context)).resolves.toBe("phx_secret");
    expect(calls.map((call) => call.name)).toEqual(["EncryptCommand", "DecryptCommand"]);
    expect(calls[0].input.EncryptionContext).toEqual({ purpose: "posthog-api-key", userId: "u1", connectionId: "c1" });
  });

  it("opens with the key the secret was sealed with", async () => {
    const { client, calls } = fakeKms();
    const sealed = await createKmsSecretBox("old-key", { client }).seal("phx_secret", context);
    await createKmsSecretBox("new-key", { client }).open(sealed, context);
    expect(calls[1].input.KeyId).toBe("old-key");
  });

  it("won't open a secret copied to another connection", async () => {
    const { client } = fakeKms();
    const kms = createKmsSecretBox(KEY, { client });
    const sealed = await kms.seal("phx_secret", context);
    await expect(kms.open(sealed, { ...context, connectionId: "c2" })).rejects.toBeInstanceOf(SecretUnreadableError);
  });

  it("reports other KMS failures as temporary", async () => {
    const denied = Object.assign(new Error("denied"), { name: "AccessDeniedException" });
    const client: KmsClient = { send: (async () => { throw denied; }) as unknown as KmsClient["send"] };
    const kms = createKmsSecretBox(KEY, { client });
    await expect(kms.seal("phx_secret", context)).rejects.toBeInstanceOf(SecretStorageUnavailableError);
    await expect(kms.open({ v: 1, provider: "kms", keyId: KEY, ciphertext: "eA==" }, context)).rejects.toBeInstanceOf(
      SecretStorageUnavailableError,
    );
  });

  it("refuses plaintext rows before calling KMS", async () => {
    const { client, calls } = fakeKms();
    await expect(
      createKmsSecretBox(KEY, { client }).open({ v: 1, provider: "plaintext", value: "phx_secret" }, context),
    ).rejects.toBeInstanceOf(SecretProviderMismatchError);
    expect(calls).toEqual([]);
  });
});
