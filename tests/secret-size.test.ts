import { sql } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createConnectionService } from "@/lib/connections/service";
import { createDatabase } from "@/lib/db";
import { apps, dataConnections } from "@/lib/db/schema";
import { MAX_SECRET_BYTES, SecretTooLargeError, secretBytes, type SecretBox, type SecretContext } from "@/lib/secrets";
import { createKmsSecretBox, type KmsClient } from "@/lib/secrets/kms";
import { plaintextSecretBox } from "@/lib/secrets/plaintext";
import { mcpSource } from "@/lib/sources/mcp/source";
import type { ConnectionSource } from "@/lib/sources/types";

import { TEST_DATABASE_URL } from "./global-setup";

/*
 * Secrets are capped at MAX_SECRET_BYTES (64 KB). Credentials over that are
 * refused on their form field before any secret store sees them, and logged
 * (source and size only), so we learn if real credentials ever hit it.
 */

const context: SecretContext = { purpose: "mcp-api-key", userId: "u1", connectionId: "c1" };

describe("the secret stores", () => {
  it("count bytes, not characters", () => {
    expect(secretBytes("abc")).toBe(3);
    expect(secretBytes("é")).toBe(2);
    expect(secretBytes("🔑")).toBe(4);
  });

  it("refuse a secret over the limit, plaintext and KMS alike, without calling KMS", async () => {
    await expect(plaintextSecretBox.seal("x".repeat(MAX_SECRET_BYTES), context)).resolves.toMatchObject({ provider: "plaintext" });
    await expect(plaintextSecretBox.seal("x".repeat(MAX_SECRET_BYTES + 1), context)).rejects.toBeInstanceOf(SecretTooLargeError);

    const send = vi.fn();
    const kms = createKmsSecretBox("key", { client: { send } as unknown as KmsClient, roleArn: "role" });
    const error = await kms.seal("é".repeat(32_769), context).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(SecretTooLargeError);
    expect((error as SecretTooLargeError).bytes).toBe(65_538);
    expect(send).not.toHaveBeenCalled();
  });

  it("never put the secret in the error", () => {
    const secret = "sk_live_" + "s".repeat(70_000);
    const error = new SecretTooLargeError(secretBytes(secret));
    expect(error.message).not.toContain("sk_live_");
  });
});

describe("the connection service", () => {
  const { db, pool } = createDatabase(TEST_DATABASE_URL);
  const seal = vi.fn(plaintextSecretBox.seal);
  const secrets: SecretBox = { ...plaintextSecretBox, seal };
  const test = vi.fn(async () => []);
  const service = createConnectionService({
    db,
    secrets: () => secrets,
    sources: () => ({ ...mcpSource, test }) as unknown as ConnectionSource,
  });
  const input = (apiKey: string) => ({ type: "mcp", name: "Big key", url: "https://mcp.example.com/mcp", headerName: "Authorization", apiKey });

  let warn: ReturnType<typeof vi.spyOn>;
  beforeEach(async () => {
    await db.execute(sql`TRUNCATE ${apps}, ${dataConnections} CASCADE`);
    seal.mockClear();
    test.mockClear();
    warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => warn.mockRestore());
  afterAll(() => pool.end());

  it("saves a credential right at the limit", async () => {
    expect(await service.create("alice", input("k".repeat(MAX_SECRET_BYTES)))).toMatchObject({ ok: true });
    expect(warn).not.toHaveBeenCalled();
  });

  // Over the byte limit while under the key field's 65,536-character cap.
  it.each([
    ["two-byte characters", "é".repeat(33_000), 66_000],
    ["four-byte characters", "🔑".repeat(16_500), 66_000],
  ])("refuses an oversized credential (%s) on its field, saves nothing, and logs only its size", async (_label, apiKey, bytes) => {
    const result = await service.create("alice", input(apiKey));
    expect(result).toMatchObject({ ok: false, error: { code: "credential_too_large", field: "apiKey" } });
    if (!result.ok) expect(result.error.message).toContain(`${bytes.toLocaleString("en-US")} bytes`);
    expect(seal).not.toHaveBeenCalled();
    expect(test).not.toHaveBeenCalled();
    expect(await db.select().from(dataConnections)).toHaveLength(0);

    expect(warn).toHaveBeenCalledTimes(1);
    const line = String(warn.mock.calls[0]?.[0]);
    expect(line).toContain("secrets.too_large");
    expect(line).toContain("source=mcp");
    expect(line).toContain("operation=create");
    expect(line).toContain(`bytes=${bytes}`);
    expect(line).toContain(`limit=${MAX_SECRET_BYTES}`);
    expect(line).not.toContain(apiKey.slice(0, 20));
  });

  it("refuses an oversized replacement and keeps the old credential", async () => {
    const created = await service.create("alice", input("small-key"));
    if (!created.ok) throw new Error(created.error.code);
    const result = await service.replaceCredential("alice", { id: created.data.id, credential: "é".repeat(33_000) });
    expect(result).toMatchObject({ ok: false, error: { code: "credential_too_large", field: "apiKey" } });
    expect(String(warn.mock.calls[0]?.[0])).toContain("operation=replace");
    expect(await service.open("alice", created.data.id, "mcp")).toMatchObject({ credential: "small-key" });
  });
});
