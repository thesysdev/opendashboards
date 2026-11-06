import { describe, expect, it } from "vitest";

import {
  getSecretBox,
  getSecretMode,
  NotImplementedError,
  SecretProviderMismatchError,
  SecretStorageNotConfiguredError,
  type SecretContext,
} from "@/lib/secrets";
import { createKmsSecretBox } from "@/lib/secrets/kms";
import { plaintextSecretBox } from "@/lib/secrets/plaintext";

const context: SecretContext = { purpose: "posthog-api-key", userId: "u1", connectionId: "c1" };

describe("getSecretBox", () => {
  it("uses KMS when KMS_KEY_ID is set, in any environment", () => {
    expect(getSecretBox({ KMS_KEY_ID: "key", NODE_ENV: "production" }).provider).toBe("kms");
    expect(getSecretBox({ KMS_KEY_ID: "key", NODE_ENV: "development" }).provider).toBe("kms");
  });

  it("uses plaintext outside production without KMS", () => {
    expect(getSecretBox({ NODE_ENV: "development" }).provider).toBe("plaintext");
  });

  it("refuses production without KMS", () => {
    expect(() => getSecretBox({ NODE_ENV: "production" })).toThrow(SecretStorageNotConfiguredError);
    expect(getSecretMode({ NODE_ENV: "production" })).toBe("unconfigured");
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

describe("KMS provider (stub)", () => {
  const kms = createKmsSecretBox("arn:aws:kms:test");

  it("throws NotImplemented when sealing", async () => {
    await expect(kms.seal("phx_secret", context)).rejects.toBeInstanceOf(NotImplementedError);
  });

  it("refuses plaintext rows before anything else", async () => {
    await expect(
      kms.open({ v: 1, provider: "plaintext", value: "phx_secret" }, context),
    ).rejects.toBeInstanceOf(SecretProviderMismatchError);
  });

  it("throws NotImplemented when opening a KMS secret", async () => {
    await expect(
      kms.open({ v: 1, provider: "kms", keyId: "k", ciphertext: "x" }, context),
    ).rejects.toBeInstanceOf(NotImplementedError);
  });
});
